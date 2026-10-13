import Dexie from 'dexie';

// Tables mirrored locally for offline work. Order = safe push order
// (parents before children, so foreign keys always exist on the server).
export const TABLES = [
  'clinic_settings', 'doctors', 'profiles', 'medicines', 'rx_templates', 'clinic_services',
  'patients', 'visits', 'appointments', 'prescriptions', 'patient_files', 'letters',
  'cardiac_reports', 'implants', 'invoices', 'invoice_items', 'payments',
];

// Fields the server manages; never sent from the device.
export const SERVER_FIELDS = ['updated_at', 'row_version', 'created_by', 'updated_by'];

const SCHEMA_V1 = {
  meta: 'key',
  clinic_settings: 'id, _dirty',
  doctors: 'id, _dirty',
  profiles: 'id, _dirty',
  medicines: 'id, _dirty',
  rx_templates: 'id, _dirty',
  clinic_services: 'id, _dirty',
  patients: 'id, mr_number, phone, _dirty',
  visits: 'id, patient_id, visit_date, _dirty',
  appointments: 'id, patient_id, appt_date, _dirty',
  prescriptions: 'id, patient_id, visit_id, _dirty',
  patient_files: 'id, patient_id, visit_id, _dirty',
  letters: 'id, patient_id, visit_id, _dirty',
  invoices: 'id, patient_id, visit_id, invoice_date, _dirty',
  invoice_items: 'id, invoice_id, _dirty',
  payments: 'id, invoice_id, patient_id, _dirty',
};

// Version 2 adds the cardiac report and implant tables. Existing data is untouched.
const SCHEMA_V2 = {
  cardiac_reports: 'id, patient_id, visit_id, kind, report_date, _dirty',
  implants: 'id, patient_id, report_id, _dirty',
};

let current = null;

// One local database per signed-in user, so a reception user on a shared computer
// never sees data cached by the Admin.
export function openUserDb(userId) {
  if (current && current.name === `cardio_${userId}`) return current;
  if (current) current.close();
  const db = new Dexie(`cardio_${userId}`);
  db.version(1).stores(SCHEMA_V1);
  db.version(2).stores(SCHEMA_V2);
  current = db;
  return db;
}

export function db() {
  if (!current) throw new Error('Local database not open');
  return current;
}

export async function deleteUserDb(userId) {
  if (current && current.name === `cardio_${userId}`) { current.close(); current = null; }
  await Dexie.delete(`cardio_${userId}`);
}

export async function getMeta(key, fallback = null) {
  const r = await db().meta.get(key);
  return r ? r.value : fallback;
}
export async function setMeta(key, value) {
  await db().meta.put({ key, value });
}
