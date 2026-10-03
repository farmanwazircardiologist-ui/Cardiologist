import { db } from './db.js';
import { invoiceTotals } from './billing.js';

// Attach calculated totals to invoices (same rules as the server view).
export async function withTotals(invs) {
  if (!invs.length) return [];
  const ids = invs.map((i) => i.id);
  const [items, pays] = await Promise.all([
    db().invoice_items.where('invoice_id').anyOf(ids).toArray(),
    db().payments.where('invoice_id').anyOf(ids).toArray(),
  ]);
  const group = (arr) => arr.reduce((m, x) => ((m[x.invoice_id] ||= []).push(x), m), {});
  const bi = group(items), bp = group(pays);
  return invs.map((i) => ({ ...i, ...invoiceTotals(i, bi[i.id] || [], bp[i.id] || []) }));
}

export async function patientAccount(patientId) {
  const invs = (await db().invoices.where('patient_id').equals(patientId).toArray()).filter((i) => i.status !== 'void');
  const t = await withTotals(invs);
  const sum = (k) => Math.round(t.reduce((s, x) => s + x[k], 0) * 100) / 100;
  return { total: sum('total'), paid: sum('paid'), due: sum('due') };
}

export async function patientMap(ids) {
  const uniq = [...new Set(ids.filter(Boolean))];
  const rows = await db().patients.bulkGet(uniq);
  return Object.fromEntries(rows.filter(Boolean).map((p) => [p.id, p]));
}
