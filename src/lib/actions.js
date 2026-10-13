// Business workflows. Every function writes locally first (works offline)
// and the sync engine sends the changes when a connection is available.
import { db } from './db.js';
import { insertRow, updateRow, nextNumber, tx, uuid } from './repo.js';
import { todayISO, calcBmi, round2 } from './format.js';
import { invoiceTotals } from './billing.js';

const nowIso = () => new Date().toISOString();

// ---------------- patients ---------------------------------------------------
export async function registerPatient(data) {
  const mr = await nextNumber('MR');
  return insertRow('patients', { risk_factors: [], cardiac_history: [], anticoagulant: 'none', ...data, mr_number: mr });
}

// Soft-delete only: the database blocks a real DELETE on patients so that
// nothing referencing them (visits, invoices, audit history) is ever
// orphaned. Blocked when it would hide unresolved money or an open visit,
// so a due balance or in-progress consultation can never silently vanish.
export async function deletePatient(patient, reason) {
  const [totals, openVisit] = await Promise.all([
    patientTotals(patient.id),
    db().visits.filter((v) => v.patient_id === patient.id && v.status === 'open' && !v.deleted_at).first(),
  ]);
  if (totals.due > 0) throw new Error(`Cannot delete: this patient has an outstanding due of ${totals.due}. Settle or write it off first.`);
  if (openVisit) throw new Error('Cannot delete: this patient has an open visit. Complete or cancel it first.');
  return updateRow('patients', patient.id, { deleted_at: nowIso(), delete_reason: reason || null });
}

export async function findPossibleDuplicates({ full_name, phone }) {
  const name = (full_name || '').trim().toLowerCase();
  const ph = (phone || '').replace(/\D/g, '');
  if (!name && !ph) return [];
  return db().patients.filter((p) => !p.deleted_at && (
    (ph && (p.phone || '').replace(/\D/g, '') === ph && (p.full_name || '').toLowerCase().split(' ')[0] === name.split(' ')[0])
    || (name && (p.full_name || '').toLowerCase() === name && ph && (p.phone || '').replace(/\D/g, '') === ph)
  )).toArray();
}

export function searchPatients(all, q, { includeArchived = false } = {}) {
  const s = q.trim().toLowerCase();
  const digits = s.replace(/\D/g, '');
  return all.filter((p) => {
    if (p.deleted_at) return false;
    if (!includeArchived && (p.archived_at || p.anonymized_at)) return false;
    if (!s) return true;
    return (p.full_name || '').toLowerCase().includes(s)
      || (p.mr_number || '').toLowerCase().includes(s)
      || (digits.length >= 3 && (p.phone || '').replace(/\D/g, '').includes(digits));
  });
}

// ---------------- visits -----------------------------------------------------
// ONE consultation = ONE visit. If today's visit with this doctor exists, it is
// reopened instead of creating another. Nothing else is created here: the
// prescription appears when the doctor writes the first medicine, and the
// invoice only when someone presses "Create invoice".
export async function findTodaysVisit(patientId, doctorId) {
  const today = todayISO();
  return db().visits.where('patient_id').equals(patientId)
    .filter((v) => v.visit_date === today && v.doctor_id === doctorId && !v.deleted_at && v.status !== 'cancelled')
    .first();
}

export async function startVisit({ patientId, doctorId, appointmentId = null }) {
  const existing = await findTodaysVisit(patientId, doctorId);
  if (existing) {
    if (existing.status === 'completed') await updateRow('visits', existing.id, { status: 'open' });
    if (appointmentId) await updateRow('appointments', appointmentId, { status: 'in_consultation', visit_id: existing.id });
    return existing;
  }
  // A patient waiting in today's queue is linked to the visit automatically.
  if (!appointmentId) {
    const today = todayISO();
    const appt = await db().appointments.where('patient_id').equals(patientId)
      .filter((a) => a.appt_date === today && !a.visit_id && !a.deleted_at && !['cancelled', 'completed'].includes(a.status)).first();
    if (appt) appointmentId = appt.id;
  }
  const visitNumber = await nextNumber('V');
  let visit;
  await tx(['visits', 'appointments'], async () => {
    visit = await insertRow('visits', {
      visit_number: visitNumber, patient_id: patientId, doctor_id: doctorId,
      visit_date: todayISO(), status: 'open',
    });
    if (appointmentId) await updateRow('appointments', appointmentId, { status: 'in_consultation', visit_id: visit.id });
  });
  return visit;
}

// Latest earlier visit (for the "Last visit" panel and repeat prescription).
export async function previousVisit(visit) {
  const list = await db().visits.where('patient_id').equals(visit.patient_id)
    .filter((v) => v.id !== visit.id && !v.deleted_at && v.status !== 'cancelled'
      && (v.visit_date < visit.visit_date || (v.visit_date === visit.visit_date && (v.created_at || '') < (visit.created_at || ''))))
    .toArray();
  list.sort((a, b) => b.visit_date.localeCompare(a.visit_date) || (b.created_at || '').localeCompare(a.created_at || ''));
  const v = list[0];
  if (!v) return null;
  const rx = await getVisitPrescription(v.id);
  return { visit: v, rx: rx || null };
}

export async function saveVisitFields(visit, patch) {
  const cur = (await db().visits.get(visit.id)) || visit;
  const next = { ...cur, ...patch };
  const bmi = calcBmi(next.weight_kg, next.height_cm);
  return updateRow('visits', visit.id, { ...patch, bmi });
}

// Cancels a mistaken visit. Nothing is deleted (the database blocks that);
// this only flips its status, which frees the one-visit-per-day slot so a
// correct visit can be started right away. Blocked once money has actually
// been received, so a paid visit can't quietly disappear - reverse the
// payment first if it truly needs to be undone.
export async function cancelVisit(visit, reason) {
  const inv = await db().invoices.where('visit_id').equals(visit.id)
    .filter((i) => i.status !== 'void').first();
  if (inv) {
    const paid = (await db().payments.where('invoice_id').equals(inv.id)
      .filter((p) => p.kind !== 'reversal').toArray()).length;
    if (paid) throw new Error('Cannot cancel: a payment was already received for this visit. Reverse the payment first.');
  }
  await tx(['visits', 'appointments'], async () => {
    await updateRow('visits', visit.id, { status: 'cancelled', cancel_reason: reason || null });
    const appt = await db().appointments.filter((a) => (a.visit_id === visit.id || a.source_visit_id === visit.id) && a.status !== 'cancelled').first();
    if (appt) await updateRow('appointments', appt.id, { status: 'cancelled', visit_id: null });
  });
}

// ---------------- appointments ----------------------------------------------
// Creates ONLY an appointment. A visit is created later by "Start visit".
export async function bookAppointment({ patientId, doctorId, date, time = null, kind = 'new', sourceVisitId = null, notes = '' }) {
  if (time) {
    const clash = await db().appointments.where('appt_date').equals(date)
      .filter((a) => a.doctor_id === doctorId && a.appt_time && a.appt_time.slice(0, 5) === time.slice(0, 5)
        && a.status !== 'cancelled' && !a.deleted_at).first();
    if (clash) throw new Error('This doctor already has an appointment at that time.');
  }
  const n = await nextNumber('AP');
  return insertRow('appointments', {
    appt_number: n, patient_id: patientId, doctor_id: doctorId, appt_date: date, appt_time: time || null,
    kind, status: 'scheduled', source_visit_id: sourceVisitId, notes,
  });
}

export async function cancelAppointment(appt, reason) {
  return updateRow('appointments', appt.id, { status: 'cancelled', cancel_reason: reason || null });
}

// Follow-up from a visit: create or move the single follow-up appointment.
export async function setFollowUp(visit, date) {
  const existing = await db().appointments.where('patient_id').equals(visit.patient_id)
    .filter((a) => a.source_visit_id === visit.id && a.status !== 'cancelled' && !a.deleted_at).first();
  const rx = await db().prescriptions.where('visit_id').equals(visit.id).filter((r) => !r.deleted_at).first();
  if (rx) await updateRow('prescriptions', rx.id, { follow_up_date: date });
  if (!date) {
    if (existing) await updateRow('appointments', existing.id, { status: 'cancelled' });
    return null;
  }
  if (existing) return updateRow('appointments', existing.id, { appt_date: date });
  return bookAppointment({ patientId: visit.patient_id, doctorId: visit.doctor_id, date, kind: 'follow_up', sourceVisitId: visit.id });
}

// ---------------- billing ----------------------------------------------------
// Invoices are made ONLY on request ("Create invoice"), with the services
// ticked at that moment. One active invoice per visit.
export async function visitInvoice(visitId) {
  return db().invoices.where('visit_id').equals(visitId).filter((i) => i.status !== 'void').first();
}

export async function createInvoice({ patientId, visit = null, services = [], date = todayISO() }) {
  if (!patientId) throw new Error('Choose the patient first.');
  const priced = services.filter((s) => s && s.price != null);
  const unpriced = services.filter((s) => s && s.price == null);
  if (unpriced.length) throw new Error(`Set a price for ${unpriced.map((s) => `"${s.name}"`).join(', ')} in Settings → Services first.`);
  if (!priced.length) throw new Error('Tick at least one service to bill.');
  if (visit) {
    const found = await visitInvoice(visit.id);
    if (found) throw new Error('This visit already has an invoice. Open it to add items.');
  }
  const n = await nextNumber('INV');
  let inv;
  await tx(['invoices', 'invoice_items'], async () => {
    inv = await insertRow('invoices', {
      invoice_number: n, patient_id: patientId, visit_id: visit?.id || null,
      invoice_date: visit?.visit_date || date, discount: 0, status: 'open',
    });
    for (const s of priced) {
      await insertRow('invoice_items', {
        invoice_id: inv.id, description: s.name, service_id: s.id,
        quantity: 1, unit_price: Number(s.price), status: 'active',
      });
    }
  });
  return inv;
}

export async function addServiceToInvoice(invoice, service) {
  const line = await db().invoice_items.where('invoice_id').equals(invoice.id)
    .filter((l) => l.service_id === service.id && l.status === 'active').first();
  if (line) return line;
  return insertRow('invoice_items', {
    invoice_id: invoice.id, description: service.name, service_id: service.id,
    quantity: 1, unit_price: Number(service.price || 0), status: 'active',
  });
}

export async function removeInvoiceLine(line) {
  return updateRow('invoice_items', line.id, { status: 'cancelled' });
}

export async function loadInvoiceTotals(invoice) {
  const [items, payments] = await Promise.all([
    db().invoice_items.where('invoice_id').equals(invoice.id).toArray(),
    db().payments.where('invoice_id').equals(invoice.id).toArray(),
  ]);
  return invoiceTotals(invoice, items, payments);
}

export async function addPayment(invoice, { amount, method, reference }) {
  const amt = round2(amount);
  if (!(amt > 0)) throw new Error('Enter an amount greater than zero.');
  if (invoice.status === 'void') throw new Error('This invoice is void.');
  const t = await loadInvoiceTotals(invoice);
  if (amt > t.due + 0.001) throw new Error(`Amount is more than the due (${t.due}).`);
  const n = await nextNumber('PAY');
  return insertRow('payments', {
    payment_number: n, invoice_id: invoice.id, patient_id: invoice.patient_id, amount: amt,
    method, reference: reference || null, kind: 'payment', received_at: nowIso(),
  });
}

export async function reversePayment(payment, reason) {
  if (!reason?.trim()) throw new Error('A reason is required.');
  const already = await db().payments.filter((p) => p.reverses_payment_id === payment.id).first();
  if (already) throw new Error('This payment has already been reversed.');
  const n = await nextNumber('PAY');
  return insertRow('payments', {
    payment_number: n, invoice_id: payment.invoice_id, patient_id: payment.patient_id,
    amount: -Number(payment.amount), method: payment.method, kind: 'reversal',
    reverses_payment_id: payment.id, reason: reason.trim(), received_at: nowIso(),
  });
}

export async function voidInvoice(invoice, reason) {
  if (!reason?.trim()) throw new Error('A reason is required.');
  const t = await loadInvoiceTotals(invoice);
  if (t.paid > 0) throw new Error('Reverse the payments on this invoice before voiding it.');
  return updateRow('invoices', invoice.id, { status: 'void', void_reason: reason.trim(), voided_at: nowIso() });
}

export async function patientTotals(patientId) {
  const invoices = (await db().invoices.where('patient_id').equals(patientId).toArray()).filter((i) => i.status !== 'void');
  let total = 0, paid = 0, due = 0;
  for (const inv of invoices) {
    const t = await loadInvoiceTotals(inv);
    total += t.total; paid += t.paid; due += t.due;
  }
  return { total: round2(total), paid: round2(paid), due: round2(due) };
}

// ---------------- prescriptions ---------------------------------------------
export async function getVisitPrescription(visitId) {
  return db().prescriptions.where('visit_id').equals(visitId).filter((r) => !r.deleted_at).first();
}

const cleanMeds = (meds) => (meds || []).filter((m) => m?.name?.trim())
  .map(({ key, ...m }) => ({ ...m, name: m.name.trim() }));

export async function savePrescription(visit, patch) {
  const data = { ...patch };
  if (data.medicines) data.medicines = cleanMeds(data.medicines);
  let rx = await getVisitPrescription(visit.id);
  if (!rx) {
    const n = await nextNumber('RX');
    const fu = await db().appointments.where('patient_id').equals(visit.patient_id)
      .filter((a) => a.source_visit_id === visit.id && a.status !== 'cancelled' && !a.deleted_at).first();
    rx = await insertRow('prescriptions', {
      rx_number: n, visit_id: visit.id, patient_id: visit.patient_id, doctor_id: visit.doctor_id,
      diagnosis: visit.diagnosis || '', medicines: [], investigations: [], advice: '',
      follow_up_date: fu?.appt_date || null, ...data,
    });
  } else {
    rx = await updateRow('prescriptions', rx.id, data);
  }
  if (data.medicines) await learnMedicines(data.medicines);
  return rx;
}

// Copy medicines (and tests/advice) from an older prescription into THIS visit.
export async function copyPrescription(visit, fromRx) {
  if (fromRx.visit_id === visit.id) throw new Error('That is already this visit\'s prescription.');
  const meds = (fromRx.medicines || []).map((m) => ({ ...m, key: uuid() }));
  return savePrescription(visit, {
    medicines: meds, copied_from_id: fromRx.id,
    diagnosis: fromRx.diagnosis || visit.diagnosis || '',
    investigations: fromRx.investigations || [], advice: fromRx.advice || '',
  });
}

// Apply a template. mode "replace" swaps the medicines; "add" appends the
// ones not already on the prescription.
export async function applyTemplate(visit, tpl, mode = 'replace') {
  const rx = await getVisitPrescription(visit.id);
  const current = rx?.medicines || [];
  const incoming = (tpl.medicines || []).map((m) => ({ ...m }));
  const has = new Set(current.map((m) => m.name.toLowerCase()));
  const medicines = mode === 'add' ? [...current, ...incoming.filter((m) => !has.has(m.name.toLowerCase()))] : incoming;
  const inv = [...new Set([...(mode === 'add' ? rx?.investigations || [] : []), ...(tpl.investigations || [])])];
  const advice = mode === 'add' && rx?.advice ? [rx.advice, tpl.advice].filter(Boolean).join('\n') : (tpl.advice || '');
  return savePrescription(visit, {
    medicines, investigations: inv, advice, template_id: tpl.id,
    diagnosis: (mode === 'add' && rx?.diagnosis) || tpl.diagnosis || visit.diagnosis || '',
  });
}

export async function saveTemplateFromRx(rx, name) {
  if (!name?.trim()) throw new Error('Give the template a name.');
  const exists = await db().rx_templates.filter((t) => t.name.toLowerCase() === name.trim().toLowerCase()).first();
  const data = {
    name: name.trim(), diagnosis: rx.diagnosis || null, medicines: cleanMeds(rx.medicines),
    investigations: rx.investigations || [], advice: rx.advice || null, active: true,
  };
  if (exists) return updateRow('rx_templates', exists.id, data);
  const count = await db().rx_templates.count();
  return insertRow('rx_templates', { ...data, sort_order: count + 1 });
}

async function learnMedicines(meds) {
  const known = new Set((await db().medicines.toArray()).map((m) => m.name.trim().toLowerCase()));
  for (const m of meds) {
    const name = (m.name || '').trim();
    if (name.length > 2 && !known.has(name.toLowerCase())) {
      known.add(name.toLowerCase());
      await insertRow('medicines', {
        name, form: m.form || null, default_pattern: m.pattern || null,
        default_timing: m.timing || null, default_duration: m.duration || null, active: true,
      });
    }
  }
}

// ---------------- letters & certificates -------------------------------------
export async function createLetter({ patient, visit = null, doctor, kind, addressed_to = '', diagnosis = '', body = '', from_date = null, to_date = null }) {
  if (!doctor) throw new Error('Add the doctor in Settings first.');
  if (!body.trim()) throw new Error('The letter is empty.');
  if (from_date && to_date && to_date < from_date) throw new Error('"To" date is before "from" date.');
  const n = await nextNumber('DOC');
  return insertRow('letters', {
    letter_number: n, patient_id: patient.id, visit_id: visit?.id || null, doctor_id: doctor.id, kind,
    letter_date: todayISO(), addressed_to: addressed_to.trim() || null, diagnosis: diagnosis.trim() || null,
    body: body.trim(), from_date: from_date || null, to_date: to_date || null,
  });
}

// ---------------- reminders ---------------------------------------------------
export async function markReminded(appt) {
  return updateRow('appointments', appt.id, { reminded_at: new Date().toISOString() });
}

// ---------------- cardiac reports (echo, Holter, TMT, ABPM, cath, device) ---------
// A report is one row with its measurements in "data". Stents and devices are
// separate rows (implants) so they show on the patient's profile for life.
export async function listReports(patientId, { kind = null, visitId = null } = {}) {
  const rows = await db().cardiac_reports.where('patient_id').equals(patientId)
    .filter((r) => !r.deleted_at && (!kind || r.kind === kind) && (!visitId || r.visit_id === visitId)).toArray();
  return rows.sort((a, b) => (b.report_date || '').localeCompare(a.report_date || '') || (b.created_at || '').localeCompare(a.created_at || ''));
}

// The report of the same kind just before this one (for the comparison table).
export async function previousReport({ patientId, kind, date, excludeId = null }) {
  const rows = await listReports(patientId, { kind });
  return rows.find((r) => r.id !== excludeId && (r.report_date || '') <= date) || null;
}

export async function listImplants(patientId, { reportId = null } = {}) {
  const rows = await db().implants.where('patient_id').equals(patientId)
    .filter((i) => !i.deleted_at && (!reportId || i.report_id === reportId)).toArray();
  return rows.sort((a, b) => (b.implant_date || '').localeCompare(a.implant_date || ''));
}

async function syncImplants(report, rows = []) {
  const existing = await db().implants.where('report_id').equals(report.id).filter((i) => !i.deleted_at).toArray();
  const keep = new Set();
  for (const r of rows) {
    const has = [r.brand, r.model, r.serial_no, r.size, r.site].some((x) => x && String(x).trim());
    if (!has) continue;
    const body = {
      kind: r.kind || 'stent', brand: r.brand?.trim() || null, model: r.model?.trim() || null, size: r.size?.trim() || null,
      site: r.site?.trim() || null, serial_no: r.serial_no?.trim() || null, notes: r.notes?.trim() || null,
      implant_date: report.report_date, removed_date: r.removed_date || null,
    };
    if (r.id && existing.some((e) => e.id === r.id)) { keep.add(r.id); await updateRow('implants', r.id, body); }
    else { const row = await insertRow('implants', { patient_id: report.patient_id, report_id: report.id, ...body }); keep.add(row.id); }
  }
  for (const e of existing) if (!keep.has(e.id)) await updateRow('implants', e.id, { deleted_at: nowIso() });
}

// Keeps the visit's EF (used by the trend chart and the prescription) in step
// with the newest echo, so the same number is never typed twice.
async function pushEchoToVisit(report, impression) {
  if (report.kind !== 'echo' || !report.visit_id) return;
  const visit = await db().visits.get(report.visit_id);
  if (!visit || visit.status === 'cancelled') return;
  const ef = Number(report.data?.ef ?? report.data?.calc?.ef_vol ?? report.data?.calc?.ef_teich);
  const patch = {};
  if (Number.isFinite(ef) && ef >= 5 && ef <= 90) patch.echo_ef = Math.round(ef);
  if (!visit.echo_findings && impression) patch.echo_findings = impression.split('\n').slice(0, 3).map((l) => l.replace(/^\d+\.\s*/, '')).join('; ');
  if (Object.keys(patch).length) await updateRow('visits', visit.id, patch);
}

export async function saveReport({ report = null, patient, visit = null, doctor, kind, date = todayISO(), data, impression = '', advice = '', implants = [] }) {
  if (!doctor) throw new Error('Add the doctor in Settings first.');
  if (!patient) throw new Error('Choose the patient first.');
  const clean = { ...data };
  delete clean.implants;
  let out;
  await tx(['cardiac_reports', 'implants', 'visits'], async () => {
    // link to today's visit automatically so everything about one consultation stays together
    let visitId = visit?.id || report?.visit_id || null;
    if (!visitId && date === todayISO()) visitId = (await findTodaysVisit(patient.id, doctor.id))?.id || null;
    const body = { kind, report_date: date, data: clean, impression: impression.trim() || null, advice: advice.trim() || null, visit_id: visitId };
    if (report) out = await updateRow('cardiac_reports', report.id, body);
    else {
      const num = await nextNumber('RPT');
      out = await insertRow('cardiac_reports', { report_number: num, patient_id: patient.id, doctor_id: doctor.id, ...body });
    }
    await syncImplants(out, implants);
    await pushEchoToVisit(out, impression);
  });
  return out;
}

export async function deleteReport(report) {
  await tx(['cardiac_reports', 'implants'], async () => {
    await updateRow('cardiac_reports', report.id, { deleted_at: nowIso() });
    const imps = await db().implants.where('report_id').equals(report.id).filter((i) => !i.deleted_at).toArray();
    for (const i of imps) await updateRow('implants', i.id, { deleted_at: nowIso() });
  });
}

// ---------------- risk scores (saved on the visit) -------------------------------
export async function saveRiskScore(visit, key, value) {
  const cur = (await db().visits.get(visit.id)) || visit;
  const next = { ...(cur.risk_scores || {}), [key]: { ...value, saved_at: nowIso() } };
  return updateRow('visits', visit.id, { risk_scores: next });
}
