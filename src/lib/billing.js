import { round2 } from './format.js';

// Same rules as the invoice_summary view in the database.
export function invoiceTotals(invoice, items = [], payments = []) {
  const subtotal = round2(items.filter((i) => i.status !== 'cancelled')
    .reduce((s, i) => s + Number(i.quantity || 1) * Number(i.unit_price || 0), 0));
  const discount = round2(Math.min(Number(invoice?.discount || 0), subtotal));
  const total = round2(Math.max(subtotal - discount, 0));
  const paid = round2(payments.reduce((s, p) => s + Number(p.amount || 0), 0));
  const due = invoice?.status === 'void' ? 0 : round2(total - paid);
  return { subtotal, discount, total, paid, due };
}

export function sumTotals(list) {
  return list.reduce((a, t) => ({
    total: round2(a.total + t.total), paid: round2(a.paid + t.paid), due: round2(a.due + t.due),
  }), { total: 0, paid: 0, due: 0 });
}

export const PAYMENT_METHODS = [
  ['cash', 'Cash'], ['card', 'Card'], ['bank_transfer', 'Bank transfer'],
  ['jazzcash', 'JazzCash'], ['easypaisa', 'Easypaisa'], ['other', 'Other'],
];
export const methodLabel = (m) => (PAYMENT_METHODS.find((x) => x[0] === m) || [m, m])[1];
