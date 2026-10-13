import { useMemo, useState } from 'react';
import {
  ascvd, ascvdValidate, ASCVD_NOTE, CHADS_ITEMS, chadsvasc, chadsFromPatient, HASBLED_ITEMS, hasbled, hasbledFromPatient, ageYearsOf,
} from '../lib/risk.js';
import { saveRiskScore } from '../lib/actions.js';
import { fmtDate } from '../lib/format.js';
import { Field, useAction } from './ui.jsx';

// Risk calculators inside a visit. Inputs are filled from the patient's record;
// the doctor can change any of them, and the result is saved with the visit.
export function RiskPanel({ visit, patient, locked }) {
  const age = ageYearsOf(patient.dob, visit.visit_date);
  return (
    <section id="risk" className="panel section" style={{ marginTop: 14 }}>
      <div className="panel-head"><h2>Risk scores</h2><span className="faint">Filled from the record. Change anything, then save to this visit.</span></div>
      <div className="stack">
        <Ascvd visit={visit} patient={patient} age={age} locked={locked} />
        <Chads visit={visit} patient={patient} age={age} locked={locked} />
        <Bled visit={visit} patient={patient} age={age} locked={locked} />
      </div>
    </section>
  );
}

function Saved({ s }) {
  return s ? <span className="faint">Saved {fmtDate(s.saved_at)}</span> : null;
}

function Ascvd({ visit, patient, age, locked }) {
  const run = useAction();
  const saved = visit.risk_scores?.ascvd;
  const rf = patient.risk_factors || [];
  const [f, setF] = useState(() => ({
    age: age ?? '', sex: patient.gender === 'female' ? 'female' : 'male', aa: false, tc: '', hdl: '', sbp: visit.bp_systolic ?? '',
    treated: rf.includes('hypertension'), smoker: rf.includes('smoker'), diabetes: rf.includes('diabetes'), ...(saved?.inputs || {}),
  }));
  const err = ascvdValidate(f);
  const res = useMemo(() => ascvd(f), [f]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  return (
    <details className="risk" open={!!saved || undefined}>
      <summary><b>ASCVD 10-year risk</b> {saved && <span className="badge blue">{saved.pct}% {saved.band}</span>} <Saved s={saved} /></summary>
      <div className="sgrid">
        <Field label="Age (40 to 79)"><input type="number" value={f.age} onChange={set('age')} /></Field>
        <Field label="Sex"><select value={f.sex} onChange={set('sex')}><option value="male">Male</option><option value="female">Female</option></select></Field>
        <Field label="Total cholesterol (mg/dL)"><input type="number" value={f.tc} onChange={set('tc')} /></Field>
        <Field label="HDL (mg/dL)"><input type="number" value={f.hdl} onChange={set('hdl')} /></Field>
        <Field label="Systolic BP (mmHg)"><input type="number" value={f.sbp} onChange={set('sbp')} /></Field>
        <div className="f wide"><div className="checks">
          {[['treated', 'On BP treatment'], ['smoker', 'Current smoker'], ['diabetes', 'Diabetes'], ['aa', 'African American']].map(([k, l]) => (
            <label key={k} className="check"><input type="checkbox" checked={!!f[k]} onChange={set(k)} /><span>{l}</span></label>
          ))}
        </div></div>
      </div>
      <div className="risk-out">
        {res ? <><b className="risk-num">{res.pct}%</b> <span>{res.band} risk (under 5 low, 5 to 7.4 borderline, 7.5 to 19.9 intermediate, 20 and above high)</span></> : <span className="muted">{err}</span>}
      </div>
      <p className="faint">{ASCVD_NOTE}</p>
      <button type="button" className="btn small" disabled={!res || locked} onClick={() => run(() => saveRiskScore(visit, 'ascvd', { inputs: f, pct: res.pct, band: res.band }), 'Saved')}>Save to this visit</button>
    </details>
  );
}

function Checklist({ items, value, onChange, weights }) {
  return (
    <div className="checks">
      {items.map(([k, l, w]) => (
        <label key={k} className="check">
          <input type="checkbox" checked={!!value[k]} onChange={(e) => onChange({ ...value, [k]: e.target.checked })} />
          <span>{l}{weights && <small>{w} point{w > 1 ? 's' : ''}</small>}</span>
        </label>
      ))}
    </div>
  );
}

function Chads({ visit, patient, age, locked }) {
  const run = useAction();
  const saved = visit.risk_scores?.chadsvasc;
  const [v, setV] = useState(() => saved?.items || chadsFromPatient(patient, age ?? 0, visit.echo_ef));
  const res = chadsvasc(v);
  return (
    <details className="risk" open={!!saved || undefined}>
      <summary><b>CHA2DS2-VASc (stroke risk in atrial fibrillation)</b> {saved && <span className="badge blue">Score {saved.score}</span>} <Saved s={saved} /></summary>
      <Checklist items={CHADS_ITEMS} value={v} onChange={setV} weights />
      <div className="risk-out"><b className="risk-num">{res.score}</b> <span>{res.advice}. Yearly stroke risk about {res.annual}% without treatment.</span></div>
      <button type="button" className="btn small" disabled={locked} onClick={() => run(() => saveRiskScore(visit, 'chadsvasc', { items: v, score: res.score, advice: res.advice }), 'Saved')}>Save to this visit</button>
    </details>
  );
}

function Bled({ visit, patient, age, locked }) {
  const run = useAction();
  const saved = visit.risk_scores?.hasbled;
  const [v, setV] = useState(() => saved?.items || hasbledFromPatient(patient, age ?? 0, visit));
  const res = hasbled(v);
  return (
    <details className="risk" open={!!saved || undefined}>
      <summary><b>HAS-BLED (bleeding risk on blood thinners)</b> {saved && <span className="badge blue">Score {saved.score}</span>} <Saved s={saved} /></summary>
      <Checklist items={HASBLED_ITEMS.map(([k, l]) => [k, l, 1])} value={v} onChange={setV} />
      <div className="risk-out"><b className="risk-num">{res.score}</b> <span>{res.band}. {res.advice}</span></div>
      <button type="button" className="btn small" disabled={locked} onClick={() => run(() => saveRiskScore(visit, 'hasbled', { items: v, score: res.score, band: res.band }), 'Saved')}>Save to this visit</button>
    </details>
  );
}

// Compact read-only summary for the patient profile.
export function RiskSummary({ visits }) {
  const last = [...visits].reverse().find((v) => v.risk_scores && Object.keys(v.risk_scores).length);
  if (!last) return null;
  const r = last.risk_scores;
  return (
    <div className="panel">
      <h2>Risk scores</h2>
      <table className="t"><tbody>
        {r.ascvd && <tr><td className="muted">ASCVD 10-year</td><td><b>{r.ascvd.pct}%</b> {r.ascvd.band}</td></tr>}
        {r.chadsvasc && <tr><td className="muted">CHA2DS2-VASc</td><td><b>{r.chadsvasc.score}</b> {r.chadsvasc.advice}</td></tr>}
        {r.hasbled && <tr><td className="muted">HAS-BLED</td><td><b>{r.hasbled.score}</b> {r.hasbled.band}</td></tr>}
      </tbody></table>
      <p className="faint">From the visit on {fmtDate(last.visit_date)}.</p>
    </div>
  );
}
