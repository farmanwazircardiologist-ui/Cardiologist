import { describe, it, expect, beforeAll } from 'vitest';
import { openUserDb, db } from '../src/lib/db.js';
import { initSync, syncNow, getSyncState, stopSync } from '../src/lib/sync.js';
import { updateRow } from '../src/lib/repo.js';
import * as A from '../src/lib/actions.js';
import { addDays, todayISO } from '../src/lib/format.js';
import { createMockServer } from './mockServer.js';

const server = createMockServer();
const DOC = { id: 'doc-1', full_name: 'Dr. Kamran Ali', active: true };
const CONS = { id: 's-cons', name: 'Consultation', price: 2000, auto_add: true, active: true };
const ECG = { id: 's-ecg', name: 'ECG', price: 800, auto_add: false, active: true };

async function seedCatalogue() {
  const put = (t, r) => db()[t].put({ ...r, _dirty: 0, _base: r, row_version: 1 });
  await put('doctors', DOC);
  await put('clinic_services', CONS);
  await put('clinic_services', ECG);
  await put('rx_templates', { id: 'tpl-htn', name: 'Hypertension', diagnosis: 'Essential hypertension', active: true,
    medicines: [{ form: 'Tab', name: 'Amlodipine 5 mg', pattern: '1+0+0', duration: '1 month' }], investigations: ['Lipid profile'], advice: 'Low salt diet - نمک کم کھائیں' });
}

describe('cardiology patient end-to-end (local, then synced)', () => {
  let ali, visit1, visit2;

  beforeAll(async () => {
    openUserDb('admin-device');
    initSync(server.makeClient('u-admin'));
    await syncNow(); // registers device → numbering available
    await seedCatalogue();
  });

  it('registers Ali Khan once, with a cardiac profile', async () => {
    ali = await A.registerPatient({ full_name: 'Ali Khan', phone: '03001234567', dob: '1965-03-10', gender: 'male', risk_factors: ['hypertension', 'diabetes'], cardiac_history: ['pci'], anticoagulant: 'none', allergies: 'Penicillin' });
    expect(ali.mr_number).toMatch(/^MR1-00001$/);
    expect(ali.risk_factors).toEqual(['hypertension', 'diabetes']);
  });

  it('a visit creates NOTHING else: no invoice, no prescription', async () => {
    visit1 = await A.startVisit({ patientId: ali.id, doctorId: DOC.id });
    const again = await A.startVisit({ patientId: ali.id, doctorId: DOC.id });
    expect(again.id).toBe(visit1.id);
    expect(await db().visits.count()).toBe(1);
    expect(await db().invoices.count()).toBe(0);
    expect(await db().prescriptions.count()).toBe(0);
  });

  it('records vitals, cardiac exam, ECG and Echo; BMI automatic', async () => {
    visit1 = await A.saveVisitFields(visit1, { chief_complaint: 'Chest pain on exertion', bp_systolic: 150, bp_diastolic: 95, weight_kg: 80, height_cm: 175,
      nyha_class: 'II', ecg_rhythm: 'Sinus rhythm', ecg_findings: 'ST depression', echo_ef: 45, diagnosis: 'Stable angina' });
    expect(visit1.bmi).toBe(26.1);
    expect(visit1.echo_ef).toBe(45);
  });

  it('template fills the prescription; tests and advice come with it', async () => {
    const rx = await A.applyTemplate(visit1, await db().rx_templates.get('tpl-htn'));
    expect(rx.medicines.map((m) => m.name)).toEqual(['Amlodipine 5 mg']);
    expect(rx.investigations).toEqual(['Lipid profile']);
    const more = await A.savePrescription(visit1, { medicines: [...rx.medicines, { form: 'Tab', name: 'Aspirin 75 mg', pattern: '0+1+0', timing: 'After meal', key: 'k' }, { name: '  ' }] });
    expect(more.medicines).toHaveLength(2);           // empty rows are not saved
    expect(more.medicines[1].key).toBeUndefined();    // UI-only keys are stripped
    expect(await db().medicines.filter((m) => m.name === 'Aspirin 75 mg').count()).toBe(1); // learnt for autocomplete
  });

  it('follow-up creates an appointment, NOT a visit, and is printed on the prescription', async () => {
    const appt = await A.setFollowUp(visit1, addDays(todayISO(), 30));
    expect(appt.kind).toBe('follow_up');
    expect(await db().visits.count()).toBe(1);
    expect((await A.getVisitPrescription(visit1.id)).follow_up_date).toBe(addDays(todayISO(), 30));
    await A.setFollowUp(visit1, addDays(todayISO(), 15));   // moves the same appointment
    expect(await db().appointments.count()).toBe(1);
  });

  it('invoice is made only on "Create invoice", once per visit', async () => {
    await expect(A.createInvoice({ patientId: ali.id, visit: visit1, services: [] })).rejects.toThrow(/at least one/);
    await expect(A.createInvoice({ patientId: ali.id, visit: visit1, services: [{ id: 'x', name: 'Echo', price: null }] })).rejects.toThrow(/Set a price/);
    const inv = await A.createInvoice({ patientId: ali.id, visit: visit1, services: [CONS, ECG] });
    expect((await A.loadInvoiceTotals(inv)).total).toBe(2800);
    await expect(A.createInvoice({ patientId: ali.id, visit: visit1, services: [CONS] })).rejects.toThrow(/already has an invoice/);
  });

  it('partial payment, overpayment refused, reversal restores due', async () => {
    const inv = await A.visitInvoice(visit1.id);
    const p1 = await A.addPayment(inv, { amount: 2000, method: 'cash' });
    expect((await A.loadInvoiceTotals(inv)).due).toBe(800);
    await expect(A.addPayment(inv, { amount: 5000, method: 'cash' })).rejects.toThrow(/more than the due/);
    await A.reversePayment(p1, 'Wrong amount');
    expect((await A.loadInvoiceTotals(inv)).due).toBe(2800);
    await A.addPayment(inv, { amount: 2800, method: 'jazzcash' });
    expect((await A.loadInvoiceTotals(inv)).due).toBe(0);
  });

  it('next visit sees the last visit and can repeat its prescription', async () => {
    await db().visits.add({ id: 'v2', visit_number: 'V1-00002', patient_id: ali.id, doctor_id: DOC.id, visit_date: addDays(todayISO(), 15), status: 'open', created_at: new Date().toISOString(), _dirty: 1, _rev: 1 });
    visit2 = await db().visits.get('v2');
    const prev = await A.previousVisit(visit2);
    expect(prev.visit.id).toBe(visit1.id);
    expect(prev.visit.bp_systolic).toBe(150);
    const copy = await A.copyPrescription(visit2, prev.rx);
    expect(copy.visit_id).toBe('v2');
    expect(copy.copied_from_id).toBe(prev.rx.id);
    expect(copy.medicines.map((m) => m.name)).toEqual(['Amlodipine 5 mg', 'Aspirin 75 mg']);
    expect(copy.investigations).toEqual(['Lipid profile']);
    expect((await A.getVisitPrescription(visit1.id)).medicines).toHaveLength(2); // old one untouched
  });

  it('referral letter and saving a template', async () => {
    const l = await A.createLetter({ patient: ali, visit: visit1, doctor: DOC, kind: 'referral', addressed_to: 'Cardiac surgeon', body: 'Kindly see.' });
    expect(l.letter_number).toMatch(/^DOC1-/);
    await expect(A.createLetter({ patient: ali, doctor: DOC, kind: 'medical', body: ' ' })).rejects.toThrow(/empty/);
    const t = await A.saveTemplateFromRx(await A.getVisitPrescription(visit1.id), 'Angina standard');
    expect(t.medicines).toHaveLength(2);
    const again = await A.saveTemplateFromRx(await A.getVisitPrescription(visit1.id), 'angina STANDARD');
    expect(again.id).toBe(t.id); // same name updates, no duplicate
  });

  it("patient in today's queue is linked when the visit starts", async () => {
    const pt = await A.registerPatient({ full_name: 'Queue Patient', phone: '03110000000', dob: '1970-01-01', gender: 'female' });
    const appt = await A.bookAppointment({ patientId: pt.id, doctorId: DOC.id, date: todayISO() });
    await updateRow('appointments', appt.id, { status: 'waiting' });
    const v = await A.startVisit({ patientId: pt.id, doctorId: DOC.id });
    const a = await db().appointments.get(appt.id);
    expect(a.visit_id).toBe(v.id);
    expect(a.status).toBe('in_consultation');
  });

  it('syncs everything to the server exactly once', async () => {
    await syncNow();
    expect(getSyncState().pending).toBe(0);
    expect(server.T('patients').size).toBe(2);
    expect(server.T('visits').size).toBe(3);
    expect(server.T('prescriptions').size).toBe(2);
    expect(server.T('letters').size).toBe(1);
    await syncNow(); // idempotent
    expect(server.T('payments').size).toBe(3);
    expect(server.T('invoices').size).toBe(1);
  });
});

describe('offline sync safety', () => {
  it('lost insert response does not create a duplicate', async () => {
    openUserDb('rec-device'); initSync(server.makeClient('u-rec')); await syncNow();
    const before = server.T('patients').size;
    const p = await A.registerPatient({ full_name: 'Ayesha Bibi', phone: '0311', gender: 'female', dob: '1990-01-01' });
    server.failInsertResponseOnce();
    await syncNow();                      // server stored it, but the reply was lost
    expect((await db().patients.get(p.id))._dirty).toBe(1);
    await syncNow();                      // retry detects it already exists
    expect(server.T('patients').size).toBe(before + 1);
    expect((await db().patients.get(p.id))._dirty).toBe(0);
    expect(p.mr_number.startsWith('MR2-')).toBe(true); // different device code → no number clash
  });

  it('edits to different fields on two devices are merged', async () => {
    const id = [...server.T('patients').values()].find((r) => r.full_name === 'Ayesha Bibi').id;
    openUserDb('admin-device'); initSync(server.makeClient('u-admin')); await syncNow();
    await updateRow('patients', id, { address: 'Street 5' });           // admin (not yet sent)
    openUserDb('rec-device'); initSync(server.makeClient('u-rec'));
    await updateRow('patients', id, { allergies: 'Penicillin' }); await syncNow();
    openUserDb('admin-device'); initSync(server.makeClient('u-admin')); await syncNow();
    const s = server.T('patients').get(id);
    expect(s.address).toBe('Street 5');
    expect(s.allergies).toBe('Penicillin');
    expect(server.T('sync_conflicts').size).toBe(0);
  });

  it('same field changed on two devices: server kept, other version saved (no silent loss)', async () => {
    const id = [...server.T('patients').values()].find((r) => r.full_name === 'Ayesha Bibi').id;
    await updateRow('patients', id, { phone: '0300-ADMIN' });           // admin device, offline edit
    openUserDb('rec-device'); initSync(server.makeClient('u-rec')); await syncNow();
    await updateRow('patients', id, { phone: '0300-REC' }); await syncNow();
    openUserDb('admin-device'); initSync(server.makeClient('u-admin')); await syncNow();
    expect(server.T('patients').get(id).phone).toBe('0300-REC');
    const c = [...server.T('sync_conflicts').values()];
    expect(c.length).toBe(1);
    expect(c[0].local_data.phone).toBe('0300-ADMIN');
    expect((await db().patients.get(id)).phone).toBe('0300-REC');
  });

  it('server rejection (double visit on two devices) is kept locally with a clear error', async () => {
    const pid = [...server.T('patients').values()].find((r) => r.full_name === 'Ayesha Bibi').id;
    openUserDb('rec-device'); initSync(server.makeClient('u-rec')); await syncNow();
    await db().visits.add({ id: 'vx1', visit_number: 'V2-00001', patient_id: pid, doctor_id: 'doc-1', visit_date: '2026-10-01', status: 'open', _dirty: 1, _rev: 1 });
    await syncNow();
    openUserDb('admin-device'); initSync(server.makeClient('u-admin'));
    await db().visits.add({ id: 'vx2', visit_number: 'V1-00009', patient_id: pid, doctor_id: 'doc-1', visit_date: '2026-10-01', status: 'open', _dirty: 1, _rev: 1 });
    await syncNow();
    const row = await db().visits.get('vx2');
    expect(row._dirty).toBe(1);
    expect(row._error).toMatch(/already has a visit/);
    expect(getSyncState().status).toBe('error');
    stopSync();
  });
});

describe('offline: internet drops, work continues, then syncs once', () => {
  it('essential clinic workflow while the server is unreachable', async () => {
    const srv = createMockServer();
    let down = false;
    const real = srv.makeClient('u-admin');
    const netErr = { data: null, error: { message: 'TypeError: Failed to fetch', code: '' } };
    const flaky = {
      auth: real.auth,
      rpc: (...a) => (down ? Promise.resolve(netErr) : real.rpc(...a)),
    };
    flaky.from = (t) => {
      const b = real.from(t);
      const p = new Proxy(b, { get: (o, k) => {
        if (k === 'then') return down ? (res) => Promise.resolve(netErr).then(res) : o.then.bind(o);
        const v = o[k];
        return typeof v === 'function' ? (...x) => { v.apply(o, x); return p; } : v;
      } });
      return p;
    };

    openUserDb('offline-dev'); initSync(flaky); await syncNow();   // first run online: device registered
    await seedCatalogue();
    down = true;                                                     // ---- internet lost
    const pt = await A.registerPatient({ full_name: 'Offline Patient', phone: '03009990000', dob: '1995-01-01', gender: 'female' });
    const v = await A.startVisit({ patientId: pt.id, doctorId: DOC.id });
    await A.saveVisitFields(v, { chief_complaint: 'Cough', bp_systolic: 120, bp_diastolic: 80, diagnosis: 'URTI' });
    await A.savePrescription(await db().visits.get(v.id), { medicines: [{ form: 'Tab', name: 'Amlodipine 5 mg', pattern: '1+0+0', duration: '1 month' }] });
    const inv = await A.createInvoice({ patientId: pt.id, visit: v, services: [CONS] });
    await A.addPayment(inv, { amount: 1000, method: 'cash' });
    await A.setFollowUp(await db().visits.get(v.id), addDays(todayISO(), 15));
    await syncNow();
    expect(getSyncState().status).toBe('offline');
    expect(getSyncState().pending).toBeGreaterThan(0);
    expect(srv.T('patients').size).toBe(0);                          // nothing reached the server

    down = false;                                                    // ---- internet back
    await syncNow(); await syncNow();
    expect(getSyncState().status).toBe('synced');
    expect(getSyncState().pending).toBe(0);
    for (const [t, n] of [['patients', 1], ['visits', 1], ['appointments', 1], ['prescriptions', 1], ['invoices', 1], ['invoice_items', 1], ['payments', 1]]) {
      expect([t, srv.T(t).size]).toEqual([t, n]);                    // no duplicates, nothing lost
    }
    expect([...srv.T('payments').values()][0].amount).toBe(1000);
    stopSync();
  });
});

describe('deleting a patient is a safe soft-delete, not a real DELETE', () => {
  it('is blocked by an outstanding due, then by an open visit, and succeeds once both are clear', async () => {
    openUserDb('delete-device'); initSync(server.makeClient('u-admin')); await syncNow();
    await seedCatalogue();
    const pt = await A.registerPatient({ full_name: 'To Delete', phone: '03007770000', dob: '1980-01-01', gender: 'male' });
    const v = await A.startVisit({ patientId: pt.id, doctorId: DOC.id });
    const inv = await A.createInvoice({ patientId: pt.id, visit: v, services: [CONS] });
    await expect(A.deletePatient(pt)).rejects.toThrow(/outstanding due/i);
    await A.addPayment(inv, { amount: 2000, method: 'cash' });
    await expect(A.deletePatient(pt)).rejects.toThrow(/open visit/i);
    await updateRow('visits', v.id, { status: 'completed' });
    const gone = await A.deletePatient(pt, 'duplicate entry');
    expect(gone.deleted_at).toBeTruthy();
    expect(A.searchPatients(await db().patients.toArray(), 'To Delete')).toHaveLength(0);
    expect((await db().patients.get(pt.id)).delete_reason).toBe('duplicate entry');
  });
});

describe('cancelling a visit started by mistake', () => {
  it('frees the one-visit-per-day slot, blocked once paid, and cancels its follow-up', async () => {
    openUserDb('cancel-device'); initSync(server.makeClient('u-admin')); await syncNow();
    await seedCatalogue();
    const pt = await A.registerPatient({ full_name: 'Wrong Patient Selected', phone: '03008880000', dob: '1985-05-05', gender: 'female' });
    const v1 = await A.startVisit({ patientId: pt.id, doctorId: DOC.id });
    await A.setFollowUp(v1, addDays(todayISO(), 15));
    await A.cancelVisit(v1, 'selected wrong patient');
    expect((await db().visits.get(v1.id)).status).toBe('cancelled');
    expect((await db().appointments.where('patient_id').equals(pt.id).first()).status).toBe('cancelled');
    const v2 = await A.startVisit({ patientId: pt.id, doctorId: DOC.id });
    expect(v2.id).not.toBe(v1.id);
    const inv = await A.createInvoice({ patientId: pt.id, visit: v2, services: [CONS] });
    await A.addPayment(inv, { amount: 500, method: 'cash' });
    await expect(A.cancelVisit(v2, 'test')).rejects.toThrow(/payment/i);
  });
});
