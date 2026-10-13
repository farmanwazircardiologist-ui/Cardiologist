import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, TABLES } from '../lib/db.js';
import { clean } from '../lib/repo.js';
import { withTotals, patientMap } from '../lib/queries.js';
import { methodLabel } from '../lib/billing.js';
import { addDays, fmtDate, todayISO, toISODate, csvDownload, round2 } from '../lib/format.js';
import { riskLabel, historyLabel } from '../lib/rx.js';
import { kindLabel } from '../lib/studies.js';
import { Money, useMoney, Tabs, useAction } from '../components/ui.jsx';

function rangeFor(kind, from, to) {
  const t = todayISO();
  if (kind === 'today') return [t, t];
  if (kind === 'week') { const d = new Date(); const dow = (d.getDay() + 6) % 7; return [addDays(t, -dow), t]; }
  if (kind === 'month') return [t.slice(0, 8) + '01', t];
  return [from || t, to || t];
}

export default function Reports() {
  const [kind, setKind] = useState('today');
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [tab, setTab] = useState('summary');
  const [a, b] = rangeFor(kind, from, to);
  const m = useMoney();
  const inRange = (d) => d && d >= a && d <= b;
  const localDay = (ts) => ts && toISODate(new Date(ts));

  const r = useLiveQuery(async () => {
    const [patients, visits, invsRaw, items, pays] = await Promise.all([
      db().patients.toArray(), db().visits.toArray(), db().invoices.toArray(), db().invoice_items.toArray(), db().payments.toArray(),
    ]);
    const invs = await withTotals(invsRaw.filter((i) => i.status !== 'void'));
    const rInv = invs.filter((i) => inRange(i.invoice_date));
    const rPays = pays.filter((p) => inRange(localDay(p.received_at)));
    const rVisits = visits.filter((v) => !v.deleted_at && v.status !== 'cancelled' && inRange(v.visit_date));
    const sum = (arr, f) => round2(arr.reduce((s, x) => s + f(x), 0));

    const days = {};
    for (let d = a; d <= b; d = addDays(d, 1)) days[d] = { visits: 0, billed: 0, collected: 0, newPts: 0 };
    rInv.forEach((i) => { if (days[i.invoice_date]) days[i.invoice_date].billed += i.total; });
    rPays.forEach((p) => { const d = localDay(p.received_at); if (days[d]) days[d].collected += Number(p.amount); });
    rVisits.forEach((v) => { if (days[v.visit_date]) days[v.visit_date].visits++; });
    patients.forEach((p) => { const d = localDay(p.created_at); if (days[d]) days[d].newPts++; });

    const invIds = new Set(rInv.map((i) => i.id));
    const services = {};
    items.filter((l) => invIds.has(l.invoice_id) && l.status === 'active').forEach((l) => {
      const s = (services[l.description] ||= { count: 0, amount: 0 });
      s.count += Number(l.quantity); s.amount += Number(l.quantity) * Number(l.unit_price);
    });
    const dx = {};
    rVisits.forEach((v) => String(v.diagnosis || '').split(',').map((x) => x.trim()).filter(Boolean)
      .forEach((x) => { dx[x] = (dx[x] || 0) + 1; }));
    const studies = {};
    (await db().cardiac_reports.toArray()).filter((x) => !x.deleted_at && inRange(x.report_date))
      .forEach((x) => { studies[x.kind] = (studies[x.kind] || 0) + 1; });
    const dues = invs.filter((i) => i.due > 0);
    const duePts = {};
    dues.forEach((i) => { duePts[i.patient_id] = round2((duePts[i.patient_id] || 0) + i.due); });
    const pts = await patientMap([...Object.keys(duePts), ...rPays.map((p) => p.patient_id)]);
    return {
      newPatients: patients.filter((p) => inRange(localDay(p.created_at))).length,
      patientsSeen: new Set(rVisits.map((v) => v.patient_id)).size,
      visits: rVisits.length,
      billed: sum(rInv, (i) => i.total),
      collected: sum(rPays, (p) => Number(p.amount)),
      dueInRange: sum(rInv, (i) => i.due),
      dueAll: sum(dues, (i) => i.due),
      days, services, dx, duePts, pts, rPays, studies,
    };
  }, [a, b], null);

  if (!r) return null;
  const exportDaily = () => csvDownload(`daily-${a}-to-${b}.csv`, [
    ['Date', 'Visits', 'New patients', 'Billed', 'Collected'],
    ...Object.entries(r.days).map(([d, x]) => [d, x.visits, x.newPts, round2(x.billed), round2(x.collected)]),
  ]);
  const exportPays = () => csvDownload(`payments-${a}-to-${b}.csv`, [
    ['Receipt', 'Date', 'Patient', 'MR', 'Method', 'Type', 'Amount'],
    ...r.rPays.map((p) => [p.payment_number, p.received_at, r.pts[p.patient_id]?.full_name, r.pts[p.patient_id]?.mr_number, methodLabel(p.method), p.kind, p.amount]),
  ]);
  const exportDues = () => csvDownload('outstanding-dues.csv', [
    ['Patient', 'MR', 'Phone', 'Due'],
    ...Object.entries(r.duePts).map(([id, d]) => [r.pts[id]?.full_name, r.pts[id]?.mr_number, r.pts[id]?.phone, d]),
  ]);

  return (
    <>
      <div className="page-head">
        <h1>Reports</h1>
        <span className="muted">{fmtDate(a)}{a !== b && ` – ${fmtDate(b)}`}</span>
        <div className="grow" />
        <button className="btn" onClick={() => window.print()}>Print</button>
      </div>
      <div className="panel no-print" style={{ marginBottom: 14 }}>
        <div className="row">
          <div className="chips">{[['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['custom', 'Custom']].map(([k, l]) =>
            <button key={k} className={`chip ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>{l}</button>)}</div>
          {kind === 'custom' && <>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 160 }} />
            <span>to</span>
            <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} style={{ width: 160 }} />
          </>}
        </div>
      </div>
      <div className="stats">
        <div className="stat"><b>{r.patientsSeen}</b><span>Patients seen</span></div>
        <div className="stat"><b>{r.visits}</b><span>Visits</span></div>
        <div className="stat"><b>{r.newPatients}</b><span>New registrations</span></div>
        <div className="stat"><b className="money">{m(r.billed)}</b><span>Billed</span></div>
        <div className="stat"><b className="money">{m(r.collected)}</b><span>Collected</span></div>
        <div className={`stat ${r.dueInRange > 0 ? 'bad' : ''}`}><b className="money">{m(r.dueInRange)}</b><span>Due on these invoices</span></div>
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[['summary', 'Daily'], ['services', 'Services'], ['dx', 'Diagnoses'], ['payments', 'Payments'], ['dues', 'Outstanding dues'], ['backup', 'Backup']]} />
      {tab === 'summary' && (
        <div className="panel table-wrap">
          <div className="panel-head"><div className="grow" /><button className="btn small no-print" onClick={exportDaily}>Export CSV</button></div>
          <table className="t">
            <thead><tr><th>Date</th><th className="money">Visits</th><th className="money">New patients</th><th className="money">Billed</th><th className="money">Collected</th></tr></thead>
            <tbody>
              {Object.entries(r.days).reverse().map(([d, x]) => (
                <tr key={d}><td>{fmtDate(d)}</td><td className="money">{x.visits}</td><td className="money">{x.newPts}</td>
                  <td className="money"><Money v={x.billed} /></td><td className="money"><Money v={x.collected} /></td></tr>
              ))}
            </tbody>
            <tfoot><tr><td><b>Total</b></td><td className="money"><b>{r.visits}</b></td><td className="money"><b>{r.newPatients}</b></td>
              <td className="money"><b><Money v={r.billed} /></b></td><td className="money"><b><Money v={r.collected} /></b></td></tr></tfoot>
          </table>
          <p className="faint">Billed counts invoices by invoice date (void invoices excluded); collected counts payments by payment date, net of reversals.</p>
        </div>
      )}
      {tab === 'services' && (
        <div className="panel"><table className="t">
          <thead><tr><th>Service</th><th className="money">Count</th><th className="money">Amount</th></tr></thead>
          <tbody>{Object.entries(r.services).sort((x, y) => y[1].amount - x[1].amount).map(([n, x]) =>
            <tr key={n}><td>{n}</td><td className="money">{x.count}</td><td className="money"><Money v={x.amount} /></td></tr>)}
            {!Object.keys(r.services).length && <tr><td colSpan="3" className="empty">Nothing billed in this period.</td></tr>}</tbody>
        </table>
        {Object.keys(r.studies).length > 0 && (
          <table className="t" style={{ marginTop: 14 }}>
            <thead><tr><th>Cardiac reports made</th><th className="money">Count</th></tr></thead>
            <tbody>{Object.entries(r.studies).sort((x, y) => y[1] - x[1]).map(([k, c]) => <tr key={k}><td>{kindLabel(k)}</td><td className="money">{c}</td></tr>)}</tbody>
          </table>
        )}</div>
      )}
      {tab === 'dx' && (
        <div className="panel"><table className="t">
          <thead><tr><th>Diagnosis</th><th className="money">Visits</th></tr></thead>
          <tbody>{Object.entries(r.dx).sort((x, y) => y[1] - x[1]).map(([n, c]) => <tr key={n}><td>{n}</td><td className="money">{c}</td></tr>)}
            {!Object.keys(r.dx).length && <tr><td colSpan="2" className="empty">No diagnoses recorded in this period.</td></tr>}</tbody>
        </table></div>
      )}
      {tab === 'payments' && (
        <div className="panel table-wrap">
          <div className="panel-head"><div className="grow" /><button className="btn small no-print" onClick={exportPays}>Export CSV</button></div>
          <table className="t">
            <thead><tr><th>Receipt</th><th>Date</th><th>Patient</th><th>Method</th><th className="money">Amount</th></tr></thead>
            <tbody>{r.rPays.sort((x, y) => y.received_at.localeCompare(x.received_at)).map((p) => (
              <tr key={p.id}><td>{p.payment_number}</td><td>{fmtDate(p.received_at)}</td>
                <td><Link to={`/patients/${p.patient_id}`}>{r.pts[p.patient_id]?.full_name}</Link></td>
                <td>{methodLabel(p.method)}{p.kind === 'reversal' && ' (reversal)'}</td><td className="money"><Money v={p.amount} /></td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {tab === 'dues' && (
        <div className="panel table-wrap">
          <div className="panel-head"><span className="muted">All outstanding balances (any date): <b><Money v={r.dueAll} /></b></span><div className="grow" /><button className="btn small no-print" onClick={exportDues}>Export CSV</button></div>
          <table className="t">
            <thead><tr><th>Patient</th><th>Phone</th><th className="money">Due</th></tr></thead>
            <tbody>{Object.entries(r.duePts).sort((x, y) => y[1] - x[1]).map(([id, d]) => (
              <tr key={id}><td><Link to={`/patients/${id}`}>{r.pts[id]?.full_name}</Link> <span className="faint">{r.pts[id]?.mr_number}</span></td>
                <td>{r.pts[id]?.phone}</td><td className="money"><Money v={d} /></td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {tab === 'backup' && <Backup />}
    </>
  );
}

// Everything on this device, downloadable at any time (Excel opens CSV).
function Backup() {
  const run = useAction();
  const stamp = todayISO();
  async function patientsCsv() {
    const list = (await db().patients.toArray()).filter((p) => !p.deleted_at);
    csvDownload(`patients-${stamp}.csv`, [
      ['MR', 'Name', 'Father/husband', 'Phone', 'Gender', 'Date of birth', 'Address', 'CNIC', 'Allergies', 'Risk factors', 'Cardiac history', 'Cardiac notes', 'Blood thinner', 'Registered'],
      ...list.map((p) => [p.mr_number, p.full_name, p.guardian_name, p.phone, p.gender, p.dob, p.address, p.cnic, p.allergies,
        (p.risk_factors || []).map(riskLabel).join('; '), (p.cardiac_history || []).map(historyLabel).join('; '), p.cardiac_notes, p.anticoagulant, p.created_at]),
    ]);
  }
  async function visitsCsv() {
    const [list, pts] = [await db().visits.toArray(), Object.fromEntries((await db().patients.toArray()).map((p) => [p.id, p]))];
    csvDownload(`visits-${stamp}.csv`, [
      ['Visit', 'Date', 'MR', 'Patient', 'Complaint', 'BP', 'Pulse', 'Weight', 'INR', 'NYHA', 'ECG', 'EF %', 'Echo', 'Diagnosis', 'Status'],
      ...list.map((v) => [v.visit_number, v.visit_date, pts[v.patient_id]?.mr_number, pts[v.patient_id]?.full_name, v.chief_complaint,
        v.bp_systolic ? `${v.bp_systolic}/${v.bp_diastolic}` : '', v.pulse, v.weight_kg, v.inr, v.nyha_class,
        [v.ecg_rhythm, v.ecg_findings].filter(Boolean).join(', '), v.echo_ef, v.echo_findings, v.diagnosis, v.status]),
    ]);
  }
  async function rxCsv() {
    const [list, pts] = [await db().prescriptions.toArray(), Object.fromEntries((await db().patients.toArray()).map((p) => [p.id, p]))];
    csvDownload(`prescriptions-${stamp}.csv`, [
      ['Prescription', 'Date', 'MR', 'Patient', 'Diagnosis', 'Medicines', 'Investigations', 'Advice', 'Next visit'],
      ...list.filter((r) => !r.deleted_at).map((r) => [r.rx_number, r.created_at, pts[r.patient_id]?.mr_number, pts[r.patient_id]?.full_name, r.diagnosis,
        (r.medicines || []).map((m) => `${m.form || ''} ${m.name} ${m.pattern || ''} ${m.duration || ''}`.trim()).join(' | '),
        (r.investigations || []).join(', '), r.advice, r.follow_up_date]),
    ]);
  }
  async function invoicesCsv() {
    const [list, pts] = [await withTotals(await db().invoices.toArray()), Object.fromEntries((await db().patients.toArray()).map((p) => [p.id, p]))];
    csvDownload(`invoices-${stamp}.csv`, [
      ['Invoice', 'Date', 'MR', 'Patient', 'Total', 'Paid', 'Due', 'Status'],
      ...list.map((i) => [i.invoice_number, i.invoice_date, pts[i.patient_id]?.mr_number, pts[i.patient_id]?.full_name, i.total, i.paid, i.due, i.status]),
    ]);
  }
  async function studiesCsv() {
    const [list, pts] = [await db().cardiac_reports.toArray(), Object.fromEntries((await db().patients.toArray()).map((p) => [p.id, p]))];
    csvDownload(`cardiac-reports-${stamp}.csv`, [
      ['Report', 'Date', 'Type', 'MR', 'Patient', 'EF', 'Impression'],
      ...list.filter((x) => !x.deleted_at).map((x) => [x.report_number, x.report_date, kindLabel(x.kind), pts[x.patient_id]?.mr_number, pts[x.patient_id]?.full_name,
        x.data?.ef ?? x.data?.ef_rest ?? '', (x.impression || '').replace(/\n/g, ' | ')]),
    ]);
  }
  async function fullJson() {
    const out = { exported_at: new Date().toISOString(), tables: {} };
    for (const t of TABLES) out.tables[t] = (await db()[t].toArray()).map(clean);
    const blob = new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `clinic-backup-${stamp}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  return (
    <div className="panel stack">
      <p className="muted" style={{ margin: 0 }}>Download the clinic's data to keep your own copy. CSV files open in Excel. The full backup contains every record on this device (sync first so it is complete). Report photos stay in Supabase Storage and are not part of these files.</p>
      <div className="row">
        <button className="btn" onClick={() => run(patientsCsv, 'Downloaded')}>Patients (CSV)</button>
        <button className="btn" onClick={() => run(visitsCsv, 'Downloaded')}>Visits (CSV)</button>
        <button className="btn" onClick={() => run(rxCsv, 'Downloaded')}>Prescriptions (CSV)</button>
        <button className="btn" onClick={() => run(invoicesCsv, 'Downloaded')}>Invoices (CSV)</button>
        <button className="btn" onClick={() => run(studiesCsv, 'Downloaded')}>Cardiac reports (CSV)</button>
        <button className="btn primary" onClick={() => run(fullJson, 'Backup downloaded')}>Full backup (JSON)</button>
      </div>
    </div>
  );
}
