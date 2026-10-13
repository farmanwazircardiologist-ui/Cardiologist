import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db.js';
import * as A from '../lib/actions.js';
import { STUDY_KINDS, kindLabel, daptEnd, implantLabel } from '../lib/studies.js';
import { fmtDate, todayISO, addDays } from '../lib/format.js';
import { Empty, ConfirmButton, useAction } from './ui.jsx';

const newUrl = (patient, kind, visit) => `/studies/new?patient=${patient.id}&kind=${kind}${visit ? `&visit=${visit.id}` : ''}`;

// Reports for one patient (or for one visit when `visit` is given).
export function StudiesList({ patient, visit = null, compact = false }) {
  const run = useAction();
  const rows = useLiveQuery(() => A.listReports(patient.id, { visitId: visit?.id }), [patient.id, visit?.id], []);
  return (
    <div className={compact ? '' : 'panel'}>
      <div className="panel-head">
        {!compact && <h2>Cardiac reports</h2>}
        <div className="grow" />
      </div>
      <div className="chips" style={{ marginBottom: 10 }}>
        {STUDY_KINDS.map(([k, l]) => <Link key={k} className="btn small" to={newUrl(patient, k, visit)}>+ {l}</Link>)}
      </div>
      {!rows.length && <Empty>{visit ? 'No report made in this visit.' : 'No echo, Holter, TMT, ABPM, cath or device report yet.'}</Empty>}
      {rows.length > 0 && (
        <div className="table-wrap"><table className="t"><tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td><b>{kindLabel(r.kind)}</b><div className="faint">{r.report_number}</div></td>
              <td>{fmtDate(r.report_date)}</td>
              <td className="study-imp">{(r.impression || '').split('\n').slice(0, 2).map((l) => l.replace(/^\d+\.\s*/, '')).join('; ')}</td>
              <td className="right nowrap">
                <Link className="btn small" to={`/print/study/${r.id}`}>Print / PDF / WhatsApp</Link>{' '}
                <Link className="btn small" to={`/studies/${r.id}`}>Edit</Link>{' '}
                <ConfirmButton label="Delete" className="btn small ghost" danger title="Delete report"
                  message={`Remove ${kindLabel(r.kind)} ${r.report_number}? It is hidden, not destroyed, and any stent or device entered with it is removed from the list too.`}
                  confirmLabel="Delete" onConfirm={async () => { const x = await run(() => A.deleteReport(r), 'Report removed'); return x !== undefined; }} />
              </td>
            </tr>
          ))}
        </tbody></table></div>
      )}
    </div>
  );
}

// Stents and devices left in the patient, with DAPT follow-up.
export function ImplantsPanel({ patient }) {
  const data = useLiveQuery(async () => {
    const [implants, reports] = await Promise.all([A.listImplants(patient.id), A.listReports(patient.id, { kind: 'cath' })]);
    const dapt = reports.map((r) => ({ r, end: daptEnd(r) })).filter((x) => x.end).sort((a, b) => b.end.localeCompare(a.end))[0] || null;
    return { implants, dapt };
  }, [patient.id], null);
  if (!data || (!data.implants.length && !data.dapt)) return null;
  const today = todayISO();
  return (
    <div className="panel">
      <h2>Stents and devices</h2>
      {data.dapt && (
        <div className={`note ${data.dapt.end < today ? '' : data.dapt.end <= addDays(today, 30) ? 'warn' : ''}`} style={{ marginBottom: 10 }}>
          DAPT ({data.dapt.r.data.dapt_drug}, {data.dapt.r.data.dapt_months}) {data.dapt.end < today ? 'course finished on' : 'continue until'} <b>{fmtDate(data.dapt.end)}</b>.
          {data.dapt.end >= today && data.dapt.end <= addDays(today, 30) ? ' Review before stopping.' : ''}
        </div>
      )}
      {data.implants.length > 0 && (
        <div className="table-wrap"><table className="t">
          <thead><tr><th>Type</th><th>Brand / model</th><th>Size</th><th>Site</th><th>Serial</th><th>Date</th></tr></thead>
          <tbody>{data.implants.map((i) => (
            <tr key={i.id}><td>{implantLabel(i.kind)}</td><td>{[i.brand, i.model].filter(Boolean).join(' ') || '-'}</td><td>{i.size || '-'}</td>
              <td>{i.site || '-'}</td><td>{i.serial_no || '-'}</td><td>{fmtDate(i.implant_date)}</td></tr>
          ))}</tbody></table></div>
      )}
    </div>
  );
}

// Used by the Dashboard: patients whose DAPT course ends soon.
export async function daptDue(days = 30) {
  const reports = (await db().cardiac_reports.filter((r) => r.kind === 'cath' && !r.deleted_at).toArray());
  const today = todayISO(), limit = addDays(today, days);
  const best = {};
  for (const r of reports) {
    const end = daptEnd(r);
    if (!end) continue;
    if (!best[r.patient_id] || end > best[r.patient_id].end) best[r.patient_id] = { r, end };
  }
  return Object.values(best).filter((x) => x.end >= today && x.end <= limit).sort((a, b) => a.end.localeCompare(b.end));
}
