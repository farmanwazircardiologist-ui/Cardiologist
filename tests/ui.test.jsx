// @vitest-environment jsdom
// Renders every screen and printable document with real local data, as the
// Doctor/Admin and as Reception, to prove the UI wiring works end to end.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const auth = { loading: false, user: { id: 'u-admin', email: 'dr@x.pk' }, profile: { id: 'u-admin', role: 'admin', active: true, full_name: 'Dr Kamran' }, role: 'admin', isAdmin: true, isReception: false, signOut: () => {}, refreshProfile: () => {} };
vi.mock('../src/lib/auth.jsx', () => ({ useAuth: () => auth, AuthProvider: ({ children }) => children }));
vi.mock('../src/lib/supabase.js', () => {
  const q = new Proxy({}, { get: (t, k) => (k === 'then' ? (r) => r({ data: [], error: null }) : () => q) });
  return { configured: true, supabase: { from: () => q, rpc: () => q, storage: { from: () => q }, auth: { getSession: async () => ({ data: {} }) } } };
});

import { Gate } from '../src/App.jsx';
import { ToastProvider } from '../src/components/ui.jsx';
import { openUserDb, db, setMeta } from '../src/lib/db.js';
import { updateRow } from '../src/lib/repo.js';
import * as A from '../src/lib/actions.js';
import { addDays, todayISO } from '../src/lib/format.js';

const put = (t, r) => db()[t].put({ ...r, _dirty: 0, _base: r, row_version: 1 });
let ids = {};

beforeAll(async () => {
  openUserDb('ui');
  await setMeta('device_code', '1');
  await put('clinic_settings', { id: 1, clinic_name: 'Dil Care Heart Clinic', address: 'Jail Road, Lahore', phone: '042-111', currency: 'Rs', phone_country_code: '92', retention_years: 5, setup_completed: true, followup_days: [7, 30], rx_print_mode: 'full', rx_paper: 'A4', rx_language: 'both' });
  await put('doctors', { id: 'doc', full_name: 'Dr. Kamran Ali', name_urdu: 'ڈاکٹر کامران علی', title_urdu: 'ماہر امراض قلب', qualification: 'MBBS, FCPS (Cardiology)', specialty: 'Consultant Cardiologist', registration_no: '12345-P', active: true });
  await put('profiles', { id: 'u-admin', role: 'admin', active: true, full_name: 'Dr Kamran' });
  await put('clinic_services', { id: 'cons', name: 'Consultation', price: 2000, auto_add: true, active: true, sort_order: 1 });
  await put('clinic_services', { id: 'ecg', name: 'ECG', price: 800, auto_add: false, active: true, sort_order: 2 });
  await put('medicines', { id: 'm1', name: 'Amlodipine 5 mg', form: 'Tab', default_pattern: '1+0+0', active: true });
  await put('rx_templates', { id: 't1', name: 'Hypertension', medicines: [{ form: 'Tab', name: 'Amlodipine 5 mg', pattern: '1+0+0' }], investigations: [], active: true });

  const pt = await A.registerPatient({ full_name: 'Ghulam Rasool', guardian_name: 'Allah Ditta', phone: '03001234567', dob: '1960-05-01', gender: 'male', risk_factors: ['hypertension', 'diabetes'], cardiac_history: ['pci'], anticoagulant: 'warfarin', inr_target: '2.0 – 3.0', allergies: 'Aspirin' });
  const visit = await A.startVisit({ patientId: pt.id, doctorId: 'doc' });
  await A.saveVisitFields(visit, { visit_date: addDays(todayISO(), -30), chief_complaint: 'Breathlessness', bp_systolic: 160, bp_diastolic: 100, pulse: 88, weight_kg: 82, height_cm: 170, inr: 2.4, nyha_class: 'II', ecg_rhythm: 'Atrial fibrillation', echo_ef: 40, diagnosis: 'Heart failure, AF' });
  const rx = await A.savePrescription(await db().visits.get(visit.id), {
    medicines: [{ form: 'Tab', name: 'Bisoprolol 2.5 mg', pattern: '1+0+0', duration: '1 month' }, { form: 'Tab', name: 'Warfarin 5 mg', pattern: '0+0+1', duration: 'Continue', note: 'Dose as per INR' }],
    investigations: ['PT / INR', 'Echocardiography'], advice: 'Low salt diet - نمک کم کھائیں',
  });
  await A.setFollowUp(await db().visits.get(visit.id), addDays(todayISO(), 1));
  await updateRow('visits', visit.id, { status: 'completed' });
  const inv = await A.createInvoice({ patientId: pt.id, visit: await db().visits.get(visit.id), services: [{ id: 'cons', name: 'Consultation', price: 2000 }] });
  const pay = await A.addPayment(inv, { amount: 1500, method: 'jazzcash' });
  const letter = await A.createLetter({ patient: pt, visit, doctor: { id: 'doc' }, kind: 'referral', addressed_to: 'Dr. Surgeon, PIC', body: 'Kindly see this patient.' });
  const visit2 = await A.startVisit({ patientId: pt.id, doctorId: 'doc' });
  ids = { pt, visit, visit2, rx, inv, pay, letter };
}, 20000);

afterEach(cleanup);

const go = (path) => render(<MemoryRouter initialEntries={[path]}><ToastProvider><Gate /></ToastProvider></MemoryRouter>);
const find = (t) => screen.findAllByText(t, { exact: false }, { timeout: 4000 });
const settle = () => new Promise((r) => setTimeout(r, 300));

describe('doctor screens render with real data', () => {
  it('dashboard shows the queue and follow-ups to remind', async () => {
    go('/');
    expect((await find('Dil Care Heart Clinic')).length).toBeGreaterThan(0);
    expect((await find('Follow-ups to remind')).length).toBe(1);
    expect((await find('Ghulam Rasool')).length).toBeGreaterThan(0);
  });
  it('profile: cardiac summary, anticoagulant badge, Total/Paid/Due, trends', async () => {
    go(`/patients/${ids.pt.id}`);
    expect((await find('Cardiac summary')).length).toBe(1);
    expect(screen.getAllByText('On warfarin').length).toBeGreaterThan(0);
    expect(screen.getByText('Trends across visits')).toBeTruthy();
    expect(document.querySelector('.acct').textContent).toMatch(/Due\s*Rs 500/);
  });
  it('second visit shows the last visit with its BP and a repeat button', async () => {
    go(`/visits/${ids.visit2.id}`);
    expect((await find('BP 160/100')).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Repeat these medicines' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Cardiac examination' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create invoice' })).toBeTruthy(); // no invoice until asked
    expect(await db().invoices.where('visit_id').equals(ids.visit2.id).count()).toBe(0);
  });
  for (const p of ['/patients', '/appointments', '/billing', '/reports', '/settings', '/settings?tab=templates', '/settings?tab=services', '/settings?tab=doctors', '/settings?tab=users', '/settings?tab=medicines']) {
    it(`renders ${p}`, async () => { go(p); await settle(); expect(document.body.textContent.length).toBeGreaterThan(20); });
  }
  it('invoice page', async () => { go(`/invoices/${ids.inv.id}`); expect((await find(ids.inv.invoice_number)).length).toBeGreaterThan(0); });
});

describe('prescription writing', () => {
  it('new visit: form shows immediately, typing autosaves, Urdu line and allergy warning appear', async () => {
    const p3 = await A.registerPatient({ full_name: 'Fresh Patient', phone: '03001112222', dob: '1970-01-01', gender: 'male', allergies: 'Aspirin' });
    const v3 = await A.startVisit({ patientId: p3.id, doctorId: 'doc' });
    expect(await A.getVisitPrescription(v3.id)).toBeUndefined();
    go(`/visits/${v3.id}`);
    const input = await screen.findByPlaceholderText('Medicine name and strength');
    fireEvent.change(input, { target: { value: 'Aspirin 75 mg' } });
    expect((await find('Allergy warning')).length).toBe(1);
    fireEvent.change(screen.getByPlaceholderText('1+0+1'), { target: { value: '0+1+0' } });
    expect((await find('دوپہر 1 گولی')).length).toBeGreaterThan(0);
    await waitFor(async () => {
      const rx = await A.getVisitPrescription(v3.id);
      expect(rx?.medicines?.[0]).toMatchObject({ name: 'Aspirin 75 mg', pattern: '0+1+0' });
    }, { timeout: 3000, interval: 100 });
  });
  it('follow-up day options come from Settings', async () => {
    go(`/visits/${ids.visit2.id}`);
    expect(await screen.findByRole('button', { name: '1 week' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: '1 month' })).toBeTruthy();
  });
});

describe('printable documents are built from data on demand', () => {
  it('prescription: letterhead, ℞, Urdu instructions, tests, next visit', async () => {
    go(`/print/rx/${ids.rx.id}`);
    expect((await find('Bisoprolol 2.5 mg')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Dr. Kamran Ali', { exact: false }).length).toBeGreaterThan(0);
    expect(screen.getByText('ڈاکٹر کامران علی')).toBeTruthy();
    expect(screen.getByText('℞')).toBeTruthy();
    expect(screen.getByText('صبح 1 گولی - 1 ماہ')).toBeTruthy();
    expect(screen.getByText('PT / INR')).toBeTruthy();
    expect(screen.getAllByText(/Next visit/).length).toBe(1);
    expect(screen.getByText(/160\/100/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'WhatsApp' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Print' })).toBeTruthy();
  });
  it('referral letter', async () => {
    go(`/print/letter/${ids.letter.id}`);
    expect((await find('Referral letter')).length).toBeGreaterThan(0);
    expect(screen.getByText('Kindly see this patient.')).toBeTruthy();
  });
  it('invoice: total − paid = due', async () => {
    go(`/print/invoice/${ids.inv.id}`);
    await find('INVOICE');
    const t = document.querySelector('.totals').textContent;
    expect(t).toMatch(/Total\s*Rs 2,000/); expect(t).toMatch(/Paid\s*Rs 1,500/); expect(t).toMatch(/Due\s*Rs 500/);
  });
  it('receipt', async () => {
    go(`/print/receipt/${ids.pay.id}`);
    expect((await find('PAYMENT RECEIPT')).length).toBe(1);
    expect(screen.getByText('JazzCash', { exact: false })).toBeTruthy();
  });
});

describe('reception user', () => {
  beforeAll(() => Object.assign(auth, { role: 'reception', isAdmin: false, isReception: true, profile: { ...auth.profile, role: 'reception' } }));
  it('gets the queue dashboard', async () => { go('/'); expect(await screen.findByRole('heading', { name: "Today's queue" })).toBeTruthy(); });
  for (const p of ['/settings', '/reports']) {
    it(`is redirected away from doctor page ${p}`, async () => {
      go(p); await settle();
      expect(document.body.textContent).not.toMatch(/Clinic & printing|Data retention|Backup/);
    });
  }
  it('cannot open prescriptions, letters or visits', async () => {
    for (const p of [`/print/rx/${ids.rx.id}`, `/print/letter/${ids.letter.id}`, `/visits/${ids.visit.id}`]) {
      go(p); await settle();
      expect(document.body.textContent).not.toMatch(/Bisoprolol|Kindly see this patient/);
      cleanup();
    }
  });
  it('patient profile offers the queue and reports, not clinical tabs', async () => {
    go(`/patients/${ids.pt.id}`);
    expect((await find('Upload report')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Cardiac summary')).toBeNull();
    expect(screen.queryByRole('button', { name: 'New visit' })).toBeNull();
  });
});
