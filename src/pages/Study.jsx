import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db.js';
import * as A from '../lib/actions.js';
import { useDoctors, usePatient } from '../lib/hooks.js';
import { fmtDate, todayISO } from '../lib/format.js';
import { ageYearsOf } from '../lib/risk.js';
import {
  sectionsFor, kindLabel, computeAll, normText, flagOf, normalTemplate, prefill, buildImpression, compareRows,
  efOf, efWord, n, IMPLANT_KINDS, STENT_BRANDS, DEVICE_BRANDS, SECTION_VESSELS,
} from '../lib/studies.js';
import { Empty, Field, useAction } from '../components/ui.jsx';
import SegPlot from '../components/SegPlot.jsx';
import { PatientHeader } from './PatientProfile.jsx';

// One page for creating and editing every kind of cardiac report.
export default function Study() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const isNew = id === 'new';
  const report = useLiveQuery(() => (isNew ? null : db().cardiac_reports.get(id)), [id]);
  const patientId = isNew ? sp.get('patient') : report?.patient_id;
  const patient = usePatient(patientId);
  const visitId = isNew ? sp.get('visit') : report?.visit_id;
  const visit = useLiveQuery(() => (visitId ? db().visits.get(visitId) : null), [visitId], undefined);
  const implants = useLiveQuery(() => (isNew || !report ? [] : A.listImplants(report.patient_id, { reportId: report.id })), [report?.id], undefined);
  const doctors = useDoctors();
  if (report === undefined || (patientId && patient === undefined) || visit === undefined || implants === undefined) return null;
  const kind = isNew ? sp.get('kind') : report?.kind;
  if (!isNew && !report) return <Empty>Report not found on this device.</Empty>;
  if (!patient || !sectionsFor(kind).length) return <Empty>Open a report from a patient's profile or from inside a visit.</Empty>;
  if (!doctors.length) return <Empty>Add the doctor in Settings first.</Empty>;
  return <Editor key={report?.id || `${patientId}-${kind}`} report={report} patient={patient} visit={visit} kind={kind} doctors={doctors} implants={implants} />;
}

function Editor({ report, patient, visit, kind, doctors, implants: savedImplants }) {
  const nav = useNavigate();
  const run = useAction();
  const doctor = doctors.find((d) => d.id === (report?.doctor_id || visit?.doctor_id)) || doctors[0];
  const [date, setDate] = useState(report?.report_date || todayISO());
  const [d, setD] = useState(() => (report ? { ...report.data } : prefill(kind, { visit, patient })));
  const [advice, setAdvice] = useState(report?.advice || '');
  const [imp, setImp] = useState({ touched: !!report?.impression, text: report?.impression || '' });
  const [impl, setImpl] = useState(() => (savedImplants.length ? savedImplants : (kind === 'device'
    ? [{ kind: 'pacemaker', site: 'Generator' }, { kind: 'other', site: 'RA lead' }, { kind: 'other', site: 'RV lead' }] : [])));
  const [busy, setBusy] = useState(false);
  const ctx = useMemo(() => ({ sex: patient.gender, age: ageYearsOf(patient.dob, date), patient }), [patient, date]);
  const sections = useMemo(() => sectionsFor(kind), [kind]);
  const calcs = useMemo(() => computeAll(kind, d, ctx), [kind, d, ctx]);
  const draft = useMemo(() => buildImpression(kind, d, ctx), [kind, d, ctx]);
  const impression = imp.touched ? imp.text : draft;
  const prev = useLiveQuery(() => A.previousReport({ patientId: patient.id, kind, date, excludeId: report?.id }), [patient.id, kind, date, report?.id], null);
  const cmp = prev ? compareRows(kind, d, prev.data, calcs, prev.data?.calc || {}) : [];
  const ef = efOf(kind, d, calcs);

  const set = (k) => (v) => setD((x) => ({ ...x, [k]: v }));

  async function save(thenPrint) {
    if (busy) return;
    setBusy(true);
    const data = cleanData(sections, d);
    data.calc = calcs;
    const r = await run(() => A.saveReport({ report, patient, visit, doctor, kind, date, data, impression, advice, implants: impl }), 'Report saved');
    setBusy(false);
    if (!r) return;
    if (thenPrint) nav(`/print/study/${r.id}`); else nav(`/patients/${patient.id}?tab=studies`);
  }

  return (
    <>
      <PatientHeader patient={patient}>
        <span className="badge blue">{kindLabel(kind)}</span>
        {report && <span className="muted">{report.report_number}</span>}
        {visit && <Link className="muted" to={`/visits/${visit.id}`}>Visit {visit.visit_number}</Link>}
      </PatientHeader>

      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
          <Field label="Report date"><input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} /></Field>
          {ef != null && <div className="study-ef"><span>EF</span><b>{ef}%</b><small>{efWord(ef)}</small></div>}
          <div className="spacer" />
          <button type="button" className="btn" onClick={() => setD((x) => ({ ...normalTemplate(kind), ...x }))}>Fill normal template</button>
        </div>
        <p className="faint" style={{ margin: '8px 0 0' }}>
          Tap the options, type only the numbers. Values outside the normal range turn red, calculated values appear by themselves,
          and the impression is drafted for you to edit. Normal template fills only the empty fields.
        </p>
      </div>

      {sections.map((s) => (
        <details key={s.id} className="panel study-sec" open={s.open || undefined}>
          <summary><h2>{s.title}</h2></summary>
          <div className="sgrid">
            {s.fields.map((f) => (
              <FieldView key={f.k} f={f} d={d} set={set(f.k)} calcs={calcs} ctx={ctx}
                impl={impl} setImpl={setImpl} patient={patient} />
            ))}
          </div>
        </details>
      ))}

      {cmp.length > 0 && (
        <div className="panel" style={{ marginTop: 14 }}>
          <h2>Compared with previous ({fmtDate(prev.report_date)})</h2>
          <table className="t"><thead><tr><th>Measurement</th><th className="right">Previous</th><th className="right">Now</th><th className="right">Change</th></tr></thead>
            <tbody>{cmp.map((r) => (
              <tr key={r.k}><td>{r.label}{r.unit ? ` (${r.unit})` : ''}</td><td className="right">{r.before ?? '-'}</td><td className="right">{r.now ?? '-'}</td>
                <td className="right">{r.diff == null ? '-' : `${r.diff > 0 ? '+' : ''}${r.diff}`}</td></tr>
            ))}</tbody></table>
        </div>
      )}

      <div className="panel" style={{ marginTop: 14 }}>
        <div className="panel-head"><h2>Impression and advice</h2><div className="grow" />
          {imp.touched && <button type="button" className="btn small ghost" onClick={() => setImp({ touched: false, text: '' })}>Redraft from entries</button>}
        </div>
        <Field label="Impression" hint={imp.touched ? '' : 'Written from the entries above. Edit anything.'}>
          <textarea rows={Math.max(4, impression.split('\n').length + 1)} value={impression} onChange={(e) => setImp({ touched: true, text: e.target.value })} />
        </Field>
        <div style={{ marginTop: 10 }}>
          <Field label="Advice / recommendation"><textarea rows={2} value={advice} onChange={(e) => setAdvice(e.target.value)} /></Field>
        </div>
        <div className="row" style={{ marginTop: 14, flexWrap: 'wrap' }}>
          <Link className="btn" to={`/patients/${patient.id}?tab=studies`}>Cancel</Link>
          <div className="spacer" />
          <button type="button" className="btn" disabled={busy} onClick={() => save(false)}>Save</button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => save(true)}>Save and print</button>
        </div>
      </div>
    </>
  );
}

// Numbers become numbers; empty values are dropped.
export function cleanData(sections, d) {
  const out = {};
  const byKey = Object.fromEntries(sections.flatMap((s) => s.fields).map((f) => [f.k, f]));
  for (const [k, v] of Object.entries(d)) {
    if (k === 'calc') continue;
    const f = byKey[k];
    if (v === '' || v == null || (Array.isArray(v) && !v.length)) continue;
    if (f?.t === 'num') { const x = n(v); if (x != null) out[k] = x; continue; }
    if (f?.t === 'vessels') {
      const vv = {};
      for (const [vk, row] of Object.entries(v || {})) {
        const pct = n(row?.pct);
        if (pct != null || row?.note) vv[vk] = { ...(pct != null ? { pct } : {}), ...(row?.note ? { note: row.note } : {}) };
      }
      if (Object.keys(vv).length) out[k] = vv;
      continue;
    }
    out[k] = v;
  }
  return out;
}

function FieldView({ f, d, set, calcs, ctx, impl, setImpl }) {
  const val = d[f.k];
  if (f.t === 'num') {
    const flag = flagOf(f, val, ctx);
    const nt = normText(f, ctx);
    return (
      <Field label={`${f.label}${f.unit ? ` (${f.unit})` : ''}`} hint={nt ? `Normal ${nt}` : ''}>
        {f.quick && (
          <div className="chips" style={{ marginBottom: 4 }}>
            {f.quick.map((q) => <button type="button" key={q} className={`chip ${n(val) === q ? 'on' : ''}`} onClick={() => set(String(q))}>{q}</button>)}
          </div>
        )}
        <input type="number" inputMode="decimal" step="any" className={flag ? `abn ${flag}` : ''} value={val ?? ''} onChange={(e) => set(e.target.value)} />
        {flag && <span className="abn-note">{flag === 'high' ? 'Above normal' : 'Below normal'}</span>}
      </Field>
    );
  }
  if (f.t === 'calc') {
    const v = calcs[f.k];
    const flag = flagOf(f, v, ctx);
    const nt = normText(f, ctx);
    return (
      <div className="f">
        <span>{f.label}</span>
        <div className={`calc ${flag ? `abn ${flag}` : ''}`}>{v != null ? `${v}${f.unit ? ` ${f.unit}` : ''}` : <small>auto</small>}</div>
        {nt && <span className="faint">Normal {nt}</span>}
      </div>
    );
  }
  if (f.t === 'pick') {
    const arr = f.multi ? (Array.isArray(val) ? val : []) : null;
    const toggle = (o) => {
      if (f.multi) set(arr.includes(o) ? arr.filter((x) => x !== o) : [...arr, o]);
      else set(val === o ? '' : o);
    };
    return (
      <div className="f wide">
        <span>{f.label}</span>
        <div className="chips">
          {f.options.map((o) => <button type="button" key={o} className={`chip ${(f.multi ? arr.includes(o) : val === o) ? 'on' : ''}`} onClick={() => toggle(o)}>{o}</button>)}
        </div>
        {f.hint && <span className="faint">{f.hint}</span>}
      </div>
    );
  }
  if (f.t === 'text') {
    return (
      <Field label={f.label}>
        {f.rows ? <textarea rows={f.rows} value={val ?? ''} onChange={(e) => set(e.target.value)} />
          : <input value={val ?? ''} placeholder={f.placeholder || ''} onChange={(e) => set(e.target.value)} />}
      </Field>
    );
  }
  if (f.t === 'seg17') {
    return (
      <div className="f wide">
        <span>{f.label}</span>
        <SegPlot value={val} onChange={set} />
      </div>
    );
  }
  if (f.t === 'vessels') {
    const v = val || {};
    const put = (k, patch) => set({ ...v, [k]: { ...(v[k] || {}), ...patch } });
    return (
      <div className="f wide">
        <span>{f.label}</span>
        <div className="vessels">
          {SECTION_VESSELS.map(([k, name]) => {
            const pct = n(v[k]?.pct);
            return (
              <div className="vrow" key={k}>
                <b>{name}</b>
                <div className="chips">
                  {[0, 30, 50, 70, 90, 99, 100].map((q) => <button type="button" key={q} className={`chip ${pct === q ? 'on' : ''}`} onClick={() => put(k, { pct: pct === q ? '' : q })}>{q}%</button>)}
                </div>
                <input type="number" min="0" max="100" inputMode="numeric" placeholder="%" value={v[k]?.pct ?? ''} onChange={(e) => put(k, { pct: e.target.value })} />
                <input placeholder="site, type (e.g. proximal, calcified, CTO)" value={v[k]?.note ?? ''} onChange={(e) => put(k, { note: e.target.value })} />
              </div>
            );
          })}
        </div>
        <span className="faint">Leave a vessel empty if it was not assessed. 70% or more (50% for left main) counts as significant.</span>
      </div>
    );
  }
  if (f.t === 'implants') return <ImplantsEditor f={f} impl={impl} setImpl={setImpl} />;
  return null;
}

function ImplantsEditor({ f, impl, setImpl }) {
  const kinds = IMPLANT_KINDS.filter(([k]) => (f.kinds || []).includes(k));
  const brands = f.kinds?.includes('stent') ? STENT_BRANDS : DEVICE_BRANDS;
  const upd = (i, patch) => setImpl(impl.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="f wide">
      <span>{f.label}</span>
      <datalist id="brands">{brands.map((b) => <option key={b} value={b} />)}</datalist>
      {impl.map((r, i) => (
        <div className="irow" key={r.id || i}>
          <select value={r.kind || kinds[0][0]} onChange={(e) => upd(i, { kind: e.target.value })}>{kinds.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <input list="brands" placeholder="Brand" value={r.brand || ''} onChange={(e) => upd(i, { brand: e.target.value })} />
          <input placeholder="Model" value={r.model || ''} onChange={(e) => upd(i, { model: e.target.value })} />
          <input placeholder={f.kinds?.includes('stent') ? 'Size e.g. 3.0 x 24 mm' : 'Size'} value={r.size || ''} onChange={(e) => upd(i, { size: e.target.value })} />
          <input placeholder={f.kinds?.includes('stent') ? 'Vessel e.g. LAD prox' : 'Position e.g. RV lead'} value={r.site || ''} onChange={(e) => upd(i, { site: e.target.value })} />
          <input placeholder="Serial / lot no." value={r.serial_no || ''} onChange={(e) => upd(i, { serial_no: e.target.value })} />
          <button type="button" className="btn small ghost" aria-label="Remove" onClick={() => setImpl(impl.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
      <div><button type="button" className="btn small" onClick={() => setImpl([...impl, { kind: kinds[0][0] }])}>{f.kinds?.includes('stent') ? 'Add stent' : 'Add generator or lead'}</button></div>
    </div>
  );
}
