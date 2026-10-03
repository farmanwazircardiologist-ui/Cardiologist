import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db.js';
import { useAuth } from '../lib/auth.jsx';
import { updateRow } from '../lib/repo.js';
import * as A from '../lib/actions.js';
import { withTotals, patientMap } from '../lib/queries.js';
import { invoiceTotals, methodLabel } from '../lib/billing.js';
import { usePatient } from '../lib/hooks.js';
import { fmtDate, fmtDateTime, round2 } from '../lib/format.js';
import { Money, DueBadge, ConfirmButton, useAction, Empty, Field, Modal } from '../components/ui.jsx';
import { PaymentModal } from './Visit.jsx';
import { patientLine } from '../components/patients.jsx';

export function Billing() {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const { isAdmin } = useAuth();
  const [q, setQ] = useState('');
  const onlyDue = sp.get('due') === '1';
  const data = useLiveQuery(async () => {
    const invs = await withTotals(await db().invoices.toArray());
    return { invs, pts: await patientMap(invs.map((i) => i.patient_id)) };
  }, [], { invs: [], pts: {} });
  const s = q.trim().toLowerCase();
  const list = data.invs
    .filter((i) => !onlyDue || (i.due > 0 && i.status !== 'void'))
    .filter((i) => !s || i.invoice_number.toLowerCase().includes(s) || (data.pts[i.patient_id]?.full_name || '').toLowerCase().includes(s)
      || (data.pts[i.patient_id]?.mr_number || '').toLowerCase().includes(s))
    .sort((a, b) => b.invoice_date.localeCompare(a.invoice_date) || b.invoice_number.localeCompare(a.invoice_number));
  const tot = list.filter((i) => i.status !== 'void').reduce((a, i) => ({ total: a.total + i.total, paid: a.paid + i.paid, due: a.due + i.due }), { total: 0, paid: 0, due: 0 });
  return (
    <>
      <div className="page-head"><h1>Billing</h1></div>
      <div className="stats">
        <div className="stat"><b className="money"><Money v={tot.total} /></b><span>Billed (shown)</span></div>
        <div className="stat"><b className="money"><Money v={tot.paid} /></b><span>Paid</span></div>
        <div className={`stat ${tot.due > 0 ? 'bad' : ''}`}><b className="money"><Money v={tot.due} /></b><span>Due</span></div>
      </div>
      <div className="panel">
        <div className="row" style={{ marginBottom: 10 }}>
          <label className="row faint"><input type="checkbox" checked={onlyDue} onChange={(e) => setSp(e.target.checked ? { due: '1' } : {})} /> Only unpaid</label>
          <div className="spacer" />
          <div className="search" style={{ width: 260 }}><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Invoice no., patient or MR" /></div>
        </div>
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Invoice</th><th>Date</th><th>Patient</th><th className="money">Total</th><th className="money">Paid</th><th className="money">Due</th><th /></tr></thead>
            <tbody>
              {list.slice(0, 300).map((i) => (
                <tr key={i.id} className="click" onClick={() => nav(`/invoices/${i.id}`)}>
                  <td>{i.invoice_number}</td><td>{fmtDate(i.invoice_date)}</td>
                  <td><b>{data.pts[i.patient_id]?.full_name}</b><div className="faint">{data.pts[i.patient_id]?.mr_number}</div></td>
                  <td className="money"><Money v={i.total} /></td><td className="money"><Money v={i.paid} /></td><td className="money"><Money v={i.due} /></td>
                  <td className="right"><DueBadge due={i.due} isVoid={i.status === 'void'} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!list.length && <Empty>No invoices match.</Empty>}
        </div>
      </div>
    </>
  );
}

export function Invoice() {
  const { id } = useParams();
  const { isAdmin } = useAuth();
  const run = useAction();
  const inv = useLiveQuery(() => db().invoices.get(id), [id]);
  const patient = usePatient(inv?.patient_id);
  const items = useLiveQuery(() => db().invoice_items.where('invoice_id').equals(id).toArray(), [id], []);
  const pays = useLiveQuery(() => db().payments.where('invoice_id').equals(id).toArray(), [id], []);
  const [pay, setPay] = useState(false);
  const [disc, setDisc] = useState(null);
  const [addLine, setAddLine] = useState(false);
  if (inv === undefined) return null;
  if (!inv) return <Empty>Invoice not found on this device.</Empty>;
  const t = invoiceTotals(inv, items, pays);
  const isVoid = inv.status === 'void';
  const reversed = new Set(pays.filter((p) => p.reverses_payment_id).map((p) => p.reverses_payment_id));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Invoice {inv.invoice_number} {isVoid && <span className="stamp" style={{ fontSize: 14, marginLeft: 8 }}>VOID</span>}</h1>
          <div className="muted"><Link to={`/patients/${inv.patient_id}`}>{patient?.full_name}</Link> · {patientLine(patient)} · {fmtDate(inv.invoice_date)}{inv.visit_id && <> · <Link to={`/visits/${inv.visit_id}`}>visit</Link></>}</div>
        </div>
        <div className="grow" />
        <Link className="btn" to={`/print/invoice/${inv.id}`}>Print / PDF / WhatsApp</Link>
        {!isVoid && t.due > 0 && <button className="btn primary" onClick={() => setPay(true)}>Receive payment</button>}
      </div>
      {isVoid && <div className="note bad" style={{ marginBottom: 14 }}>Voided {fmtDateTime(inv.voided_at)} - {inv.void_reason}. Kept for records; not counted in totals.</div>}
      <div className="grid g2">
        <div className="panel">
          <div className="panel-head"><h2>Items</h2><div className="grow" />
            {!isVoid && <button className="btn small" onClick={() => setAddLine(true)}>Add item</button>}</div>
          <table className="t">
            <thead><tr><th>Description</th><th className="money">Qty</th><th className="money">Price</th><th className="money">Amount</th><th /></tr></thead>
            <tbody>
              {items.map((l) => (
                <tr key={l.id} style={l.status === 'cancelled' ? { color: 'var(--ink-3)', textDecoration: 'line-through' } : null}>
                  <td>{l.description}</td><td className="money">{l.quantity}</td>
                  <td className="money"><Money v={l.unit_price} /></td><td className="money"><Money v={l.quantity * l.unit_price} /></td>
                  <td className="right">{isAdmin && !isVoid && l.status === 'active' &&
                    <ConfirmButton label="Remove" className="btn small ghost" title="Remove item"
                      message={`Remove "${l.description}" from this invoice? It stays visible as cancelled.`}
                      confirmLabel="Remove item"
                      onConfirm={() => run(() => A.removeInvoiceLine(l))} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="totals" style={{ marginTop: 12 }}>
            <div><span>Subtotal</span><Money v={t.subtotal} /></div>
            <div><span>Discount {isAdmin && !isVoid && <button className="btn small ghost" onClick={() => setDisc(String(inv.discount || 0))}>Change</button>}</span><Money v={t.discount} /></div>
            <div className="big"><span>Total</span><Money v={t.total} /></div>
            <div><span>Paid</span><Money v={t.paid} /></div>
            <div className="big" style={{ color: t.due > 0 ? 'var(--red)' : 'var(--green)' }}><span>Due</span><Money v={t.due} /></div>
          </div>
        </div>
        <div className="panel">
          <div className="panel-head"><h2>Payments</h2></div>
          <table className="t">
            <tbody>
              {pays.sort((a, b) => a.received_at.localeCompare(b.received_at)).map((p) => (
                <tr key={p.id}>
                  <td>{p.payment_number}<div className="faint">{fmtDateTime(p.received_at)}</div></td>
                  <td>{methodLabel(p.method)}{p.reference && <div className="faint">{p.reference}</div>}
                    {p.kind === 'reversal' && <div className="faint">Reversal: {p.reason}</div>}</td>
                  <td className="money"><Money v={p.amount} /></td>
                  <td className="right">
                    {p.kind === 'payment' && <div className="row" style={{ justifyContent: 'flex-end' }}>
                      <Link className="btn small" to={`/print/receipt/${p.id}`}>Receipt</Link>
                      {isAdmin && !reversed.has(p.id) && <ConfirmButton label="Reverse" danger title="Reverse payment" reason="Reason"
                        message={`A reversal entry of −${p.amount} will be added. The original payment stays on record.`} confirmLabel="Reverse payment"
                        onConfirm={(r) => run(() => A.reversePayment(p, r), 'Payment reversed')} />}
                      {reversed.has(p.id) && <span className="badge">Reversed</span>}
                    </div>}
                  </td>
                </tr>
              ))}
              {!pays.length && <tr><td className="empty">No payments yet.</td></tr>}
            </tbody>
          </table>
          {isAdmin && !isVoid && (
            <div style={{ marginTop: 14 }}>
              <ConfirmButton label="Void invoice" danger title="Void invoice" reason="Reason for voiding" confirmLabel="Void invoice"
                message="The invoice is kept for records but no longer counts in totals. Reverse any payments first."
                onConfirm={(r) => run(() => A.voidInvoice(inv, r), 'Invoice voided')} />
            </div>
          )}
        </div>
      </div>
      {pay && <PaymentModal invoice={{ ...inv, ...t }} onClose={() => setPay(false)} />}
      {disc !== null && (
        <Modal title="Discount" onClose={() => setDisc(null)} footer={<>
          <button className="btn" onClick={() => setDisc(null)}>Cancel</button>
          <button className="btn primary" onClick={async () => {
            const d = round2(disc);
            if (!(d >= 0) || d > t.subtotal) { run(async () => { throw new Error(`Discount must be between 0 and ${t.subtotal}.`); }); return; }
            if (t.subtotal - d < t.paid) { run(async () => { throw new Error('Discount would make the total less than what was already paid.'); }); return; }
            await run(() => updateRow('invoices', inv.id, { discount: d }), 'Discount saved');
            setDisc(null);
          }}>Save discount</button></>}>
          <Field label="Discount amount"><input type="number" min="0" step="0.01" autoFocus value={disc} onChange={(e) => setDisc(e.target.value)} /></Field>
        </Modal>
      )}
      {addLine && <AddLineModal invoice={inv} onClose={() => setAddLine(false)} />}
    </>
  );
}

function AddLineModal({ invoice, onClose }) {
  const run = useAction();
  const services = useLiveQuery(() => db().clinic_services.toArray(), [], []).filter((s) => s.active && s.price != null);
  return (
    <Modal title="Add clinic service" onClose={onClose}>
      {!services.length && <Empty>No priced services. Add them in Settings → Services.</Empty>}
      <div className="stack">
        {services.map((s) => (
          <button key={s.id} className="btn" style={{ width: '100%', justifyContent: 'space-between' }}
            onClick={async () => { await run(() => A.addServiceToInvoice(invoice, s), 'Item added'); onClose(); }}>
            {s.name}<Money v={s.price} /></button>
        ))}
      </div>
    </Modal>
  );
}
