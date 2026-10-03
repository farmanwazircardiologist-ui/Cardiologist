import { useEffect, useMemo, useState, useCallback } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db.js';
import { updateRow, uuid } from '../lib/repo.js';
import * as A from '../lib/actions.js';
import { useDoctorMap, usePatient, useSettings, useServices } from '../lib/hooks.js';
import { withTotals } from '../lib/queries.js';
import { addDays, fmtDate, todayISO, calcBmi } from '../lib/format.js';
import { PAYMENT_METHODS } from '../lib/billing.js';
import {
  FORMS, PATTERNS, TIMINGS, DURATIONS, ADVICE, INVESTIGATIONS, CHOICES,
  urduLine, englishLine, medTitle, allergyHit, adviceLine, sameAdvice,
} from '../lib/rx.js';
import { BlurInput, Field, Modal, Money, Autocomplete, useAction, Empty, ConfirmButton, ChoiceField, PhraseField } from '../components/ui.jsx';
import { PatientFiles } from '../components/Files.jsx';
import { LettersList } from '../components/Letters.jsx';
import { PatientHeader } from './PatientProfile.jsx';

const LIMITS = {
  bp_systolic: [30, 300], bp_diastolic: [10, 250], pulse: [10, 300], temperature: [80, 115], resp_rate: [4, 80],
  weight_kg: [0.3, 400], height_cm: [20, 260], spo2: [30, 100], blood_sugar: [10, 1500], inr: [0.5, 15],
  ecg_rate: [10, 300], echo_ef: [5, 90],
};
const LABEL = {
  bp_systolic: 'systolic BP', bp_diastolic: 'diastolic BP', pulse: 'pulse', temperature: 'temperature', resp_rate: 'respiratory rate',
  weight_kg: 'weight', height_cm: 'height', spo2: 'SpO₂', blood_sugar: 'blood sugar', inr: 'INR', ecg_rate: 'ECG rate', echo_ef: 'EF',
};
const DIAGNOSES = ['Hypertension', 'Stable angina', 'Ischaemic heart disease', 'Post-PCI', 'Heart failure', 'Atrial fibrillation',
  'Valvular heart disease', 'Dyslipidaemia', 'Atypical chest pain', 'Palpitations'];

export default function Visit() {
  const { id } = useParams();
  const nav = useNavigate();
  const visit = useLiveQuery(() => db().visits.get(id), [id]);
  const patient = usePatient(visit?.patient_id);
  const doctors = useDoctorMap();
  const run = useAction();
  if (visit === undefined || (visit && patient === undefined)) return null;
  if (!visit) return <Empty>Visit not found on this device.</Empty>;
  const doctor = doctors[visit.doctor_id];
  const locked = visit.status !== 'open';

  return (
    <>
      <PatientHeader patient={patient}>
        <span className="badge blue">{visit.visit_number}</span>
        <span className="muted">{fmtDate(visit.visit_date)} · {doctor?.full_name}</span>
        <div className="spacer" />
        {visit.status === 'open'
          ? <button className="btn primary" onClick={() => run(async () => {
              await updateRow('visits', visit.id, { status: 'completed' });
              const appt = await db().appointments.filter((a) => a.visit_id === visit.id && a.status !== 'cancelled').first();
              if (appt) await updateRow('appointments', appt.id, { status: 'completed' });
            }, 'Visit completed')}>Complete visit</button>
          : visit.status === 'completed' && <button className="btn" onClick={() => updateRow('visits', visit.id, { status: 'open' })}>Reopen visit</button>}
        {visit.status !== 'cancelled' && (
          <ConfirmButton label="Cancel visit" className="btn small ghost" danger title="Cancel this visit"
            message="Started by mistake? This frees up today's slot so a correct visit can be started. Nothing already saved is deleted. Blocked if a payment has already been received."
            confirmLabel="Cancel visit" reason="Reason (kept on record)"
            onConfirm={async (reason) => {
              const r = await run(() => A.cancelVisit(visit, reason), 'Visit cancelled');
              if (r !== undefined) nav(`/patients/${patient.id}`);
              return r !== undefined;
            }} />
        )}
      </PatientHeader>
      <nav className="rail no-print">
        {[['consult', 'Complaint & vitals'], ['exam', 'Examination'], ['ecg', 'ECG & Echo'], ['rx', 'Prescription'],
          ['followup', 'Follow-up'], ['reports', 'Reports'], ['letters', 'Letters'], ['bill', 'Bill']]
          .map(([k, l]) => <a key={k} href={`#${k}`}>{l}</a>)}
      </nav>
      {locked && <div className="note" style={{ marginBottom: 14 }}>
        {visit.status === 'cancelled' ? 'This visit was cancelled and can no longer be edited.' : 'This visit is completed. Reopen it to make changes. Printing still works.'}
      </div>}
      <LastVisit visit={visit} locked={locked} />
      <fieldset disabled={locked} className="plain">
        <Consultation visit={visit} patient={patient} />
        <Examination visit={visit} />
        <EcgEcho visit={visit} />
        <Prescription visit={visit} patient={patient} />
        <FollowUp visit={visit} />
      </fieldset>
      <PrintBar visit={visit} />
      <section id="reports" className="panel section" style={{ marginTop: 14 }}>
        <div className="panel-head"><h2>Reports & files</h2></div>
        <PatientFiles patientId={patient.id} visitId={visit.id} compact />
      </section>
      <section id="letters" className="panel section" style={{ marginTop: 14 }}>
        <div className="panel-head"><h2>Letters & certificates</h2></div>
        <LettersList patient={patient} visit={visit} compact />
      </section>
      <Bill visit={visit} />
    </>
  );
}

// ----------------------------------------------------------------- helpers
function useSaver(visit, setErr) {
  const run = useAction();
  return (k, isNum) => async (v) => {
    let val = v === '' ? null : v;
    if (isNum && val != null) {
      val = Number(String(val).replace(',', '.'));
      const [lo, hi] = LIMITS[k] || [-Infinity, Infinity];
      if (!Number.isFinite(val) || val < lo || val > hi) { setErr?.(`Check ${LABEL[k] || k}: allowed ${lo}–${hi}.`); return; }
    }
    setErr?.('');
    await run(() => A.saveVisitFields(visit, { [k]: val }));
  };
}

function LastVisit({ visit, locked }) {
  const run = useAction();
  const prev = useLiveQuery(() => A.previousVisit(visit), [visit.id, visit.visit_date]);
  const [open, setOpen] = useState(true);
  if (!prev) return null;
  const v = prev.visit;
  const meds = (prev.rx?.medicines || []).filter((m) => m.name);
  const vit = [
    v.bp_systolic && `BP ${v.bp_systolic}/${v.bp_diastolic}`, v.pulse && `Pulse ${v.pulse}`,
    v.weight_kg && `Wt ${v.weight_kg} kg`, v.inr && `INR ${v.inr}`, v.echo_ef && `EF ${v.echo_ef}%`,
  ].filter(Boolean);
  return (
    <section className="last-visit no-print">
      <button type="button" className="lv-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <b>Last visit · {fmtDate(v.visit_date)}</b>
        <span className="faint">{vit.join('  ·  ')}</span>
        <span className="grow" />
        <span className="faint">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <div className="lv-body">
          <div>
            {v.chief_complaint && <div><span className="faint">Complaint: </span>{v.chief_complaint}</div>}
            {v.diagnosis && <div><span className="faint">Diagnosis: </span><b>{v.diagnosis}</b></div>}
            {(v.ecg_rhythm || v.ecg_findings) && <div><span className="faint">ECG: </span>{[v.ecg_rhythm, v.ecg_findings].filter(Boolean).join(', ')}</div>}
            {prev.rx?.investigations?.length > 0 && <div><span className="faint">Tests advised: </span>{prev.rx.investigations.join(', ')}</div>}
          </div>
          <div>
            {meds.length ? <ol className="lv-meds">{meds.map((m, i) => <li key={i}><b>{medTitle(m)}</b> <span className="faint">{m.pattern} {m.duration && `· ${m.duration}`}</span></li>)}</ol>
              : <span className="faint">No medicines prescribed last time.</span>}
          </div>
          <div className="row">
            <Link className="btn small" to={`/visits/${v.id}`}>Open last visit</Link>
            {prev.rx && <Link className="btn small" to={`/print/rx/${prev.rx.id}`}>Last prescription</Link>}
            {prev.rx && meds.length > 0 && !locked && (
              <button type="button" className="btn small primary" onClick={() => run(() => A.copyPrescription(visit, prev.rx), 'Last prescription repeated - edit below if needed')}>Repeat these medicines</button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------ consultation
function Consultation({ visit, patient }) {
  const [err, setErr] = useState('');
  const save = useSaver(visit, setErr);
  const text = (k, label, rows = 2) => (
    <Field label={label}><BlurInput as="textarea" rows={rows} value={visit[k]} onSave={save(k)} /></Field>
  );
  const num = (k, label, step = '1', placeholder) => (
    <Field label={label}><BlurInput type="number" step={step} inputMode="decimal" value={visit[k] ?? ''} onSave={save(k, true)} placeholder={placeholder} /></Field>
  );
  const bp = (s, d) => async () => { await save('bp_systolic', true)(String(s)); await save('bp_diastolic', true)(String(d)); };
  const bmi = calcBmi(visit.weight_kg, visit.height_cm);
  const showInr = patient.anticoagulant === 'warfarin' || visit.inr != null;
  return (
    <section id="consult" className="panel section">
      <div className="panel-head"><h2>Complaint & vitals</h2><div className="grow" /><span className="faint">Saves automatically</span></div>
      <div className="grid g2">
        {text('chief_complaint', 'Presenting complaint')}
        {text('history', 'History')}
      </div>
      <h3 style={{ marginTop: 14 }}>Vitals</h3>
      <Field label="Blood pressure (mmHg)">
        <div className="chips" style={{ marginBottom: 6 }}>
          {[[110, 70], [120, 80], [130, 80], [140, 90], [150, 90], [160, 100], [180, 110]].map(([s, d]) => (
            <button type="button" key={s + '/' + d} className={`chip ${visit.bp_systolic === s && visit.bp_diastolic === d ? 'on' : ''}`} onClick={bp(s, d)}>{s}/{d}</button>
          ))}
        </div>
        <div className="row" style={{ flexWrap: 'nowrap', maxWidth: 320 }}>
          <BlurInput type="number" inputMode="numeric" value={visit.bp_systolic ?? ''} onSave={save('bp_systolic', true)} placeholder="systolic" aria-label="Systolic" />
          <span className="faint">/</span>
          <BlurInput type="number" inputMode="numeric" value={visit.bp_diastolic ?? ''} onSave={save('bp_diastolic', true)} placeholder="diastolic" aria-label="Diastolic" />
        </div>
      </Field>
      <div className="grid g4" style={{ marginTop: 10 }}>
        {num('pulse', 'Pulse (/min)')}
        {num('spo2', 'SpO₂ (%)')}
        {num('weight_kg', 'Weight (kg)', '0.1')}
        {num('height_cm', 'Height (cm)', '0.1')}
        <Field label="BMI (automatic)"><input readOnly value={bmi ?? ''} tabIndex={-1} /></Field>
        {num('temperature', 'Temperature (°F)', '0.1')}
        {num('resp_rate', 'Resp. rate (/min)')}
        {num('blood_sugar', 'Blood sugar (mg/dL)')}
        {showInr && num('inr', `INR${patient.inr_target ? ` (target ${patient.inr_target})` : ''}`, '0.1')}
      </div>
      {!showInr && <button type="button" className="btn small ghost" style={{ marginTop: 6 }} onClick={() => save('inr', true)('1')}>Add INR</button>}
      {err && <div className="error-text" style={{ marginTop: 6 }}>{err}</div>}
    </section>
  );
}

function Examination({ visit }) {
  const save = useSaver(visit);
  const choice = (k, label) => <ChoiceField label={label} value={visit[k] || ''} options={CHOICES[k]} onSave={save(k)} />;
  return (
    <section id="exam" className="panel section" style={{ marginTop: 14 }}>
      <div className="panel-head"><h2>Cardiac examination</h2></div>
      <div className="grid g2">
        {choice('chest_pain', 'Chest pain')}
        <Field label="NYHA class (breathlessness)">
          <div className="chips">
            {['I', 'II', 'III', 'IV'].map((c) => (
              <button type="button" key={c} className={`chip ${visit.nyha_class === c ? 'on' : ''}`} onClick={() => save('nyha_class')(visit.nyha_class === c ? '' : c)}>NYHA {c}</button>
            ))}
          </div>
        </Field>
        {choice('rhythm', 'Pulse rhythm')}
        {choice('heart_sounds', 'Heart sounds')}
        {choice('murmur', 'Murmur')}
        {choice('jvp', 'JVP')}
        {choice('edema', 'Oedema')}
        {choice('chest_exam', 'Chest / lungs')}
      </div>
      <div style={{ marginTop: 10 }}>
        <Field label="Other findings"><BlurInput as="textarea" rows={2} value={visit.examination} onSave={save('examination')} /></Field>
      </div>
    </section>
  );
}

function EcgEcho({ visit }) {
  const save = useSaver(visit);
  return (
    <section id="ecg" className="panel section" style={{ marginTop: 14 }}>
      <div className="panel-head"><h2>ECG, Echo & diagnosis</h2><span className="faint">Done here or read from the patient's reports</span></div>
      <div className="grid g2">
        <div className="stack">
          <ChoiceField label="ECG rhythm" value={visit.ecg_rhythm || ''} options={CHOICES.ecg_rhythm} onSave={save('ecg_rhythm')} />
          <Field label="ECG rate (/min)"><BlurInput type="number" inputMode="numeric" value={visit.ecg_rate ?? ''} onSave={save('ecg_rate', true)} /></Field>
          <PhraseField label="ECG findings" value={visit.ecg_findings || ''} options={CHOICES.ecg_findings} onSave={save('ecg_findings')} />
        </div>
        <div className="stack">
          <Field label="Echo - ejection fraction (EF %)">
            <div className="chips" style={{ marginBottom: 6 }}>
              {[25, 30, 35, 40, 45, 50, 55, 60].map((n) => (
                <button type="button" key={n} className={`chip ${visit.echo_ef === n ? 'on' : ''}`} onClick={() => save('echo_ef', true)(String(n))}>{n}%</button>
              ))}
            </div>
            <BlurInput type="number" inputMode="numeric" value={visit.echo_ef ?? ''} onSave={save('echo_ef', true)} placeholder="exact value" />
          </Field>
          <PhraseField label="Echo findings" value={visit.echo_findings || ''} options={CHOICES.echo_findings} onSave={save('echo_findings')} />
        </div>
      </div>
      <div style={{ marginTop: 14 }}>
        <PhraseField label="Diagnosis (printed on the prescription)" value={visit.diagnosis || ''} options={DIAGNOSES} onSave={save('diagnosis')} rows={1} />
      </div>
      <div style={{ marginTop: 10 }}>
        <Field label="Private notes (not printed)"><BlurInput as="textarea" rows={2} value={visit.notes} onSave={save('notes')} /></Field>
      </div>
    </section>
  );
}

// ------------------------------------------------------------ prescription
// A prescription usually doesn't exist yet for a visit - that is the normal
// starting state. This sentinel tells "still loading" apart from "no
// prescription yet", so the form always appears.
const NOT_LOADED = Symbol('not-loaded');
const blank = () => ({ key: uuid(), form: 'Tab', name: '', pattern: '', timing: '', duration: '', note: '', urdu: '' });

function Prescription({ visit, patient }) {
  const rx = useLiveQuery(() => A.getVisitPrescription(visit.id), [visit.id], NOT_LOADED);
  const medicines = useLiveQuery(() => db().medicines.toArray(), [], []);
  const settings = useSettings();
  const run = useAction();
  const [meds, setMeds] = useState(null);
  const [advice, setAdvice] = useState('');
  const [tests, setTests] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modal, setModal] = useState('');
  const [customTest, setCustomTest] = useState('');

  useEffect(() => {
    if (rx === NOT_LOADED || dirty) return;
    // Keep each row's key (so the field being typed in keeps focus) and keep
    // empty rows the doctor just added - saving skips them.
    setMeds((prev) => {
      const named = (prev || []).filter((m) => m.name?.trim());
      const saved = (rx?.medicines || []).map((m, i) => ({ ...m, key: named[i]?.key || uuid() }));
      const blanks = (prev || []).filter((m) => !m.name?.trim());
      const out = [...saved, ...blanks];
      return out.length ? out : [blank()];
    });
    setAdvice(rx?.advice || '');
    setTests(rx?.investigations || []);
  }, [rx, dirty]);

  const medOptions = useMemo(() => medicines.filter((m) => m.active !== false)
    .map((m) => ({ label: m.name, hint: m.form, m })), [medicines]);

  const payload = { medicines: meds || [], advice, investigations: tests, diagnosis: visit.diagnosis || '' };
  const save = useCallback(() => run(() => A.savePrescription(visit, payload)), [visit, JSON.stringify(payload)]); // eslint-disable-line

  // Autosave after a short pause in typing - nothing to remember to press.
  useEffect(() => {
    if (!dirty || meds === null) return;
    setSaving(true);
    const t = setTimeout(async () => {
      const r = await save();
      setSaving(false);
      if (r) setDirty(false);
    }, 700);
    return () => clearTimeout(t);
  }, [dirty, save, meds]);

  if (meds === null) return null;
  const change = (fn) => { fn(); setDirty(true); };
  const setMed = (i, patch) => change(() => { const n = meds.slice(); n[i] = { ...n[i], ...patch }; setMeds(n); });
  const lang = settings?.rx_language || 'both';
  const hits = meds.map((m) => allergyHit(patient.allergies, m.name));
  const reset = () => { setDirty(false); setModal(''); };

  return (
    <section id="rx" className="panel section" style={{ marginTop: 14 }}>
      <div className="panel-head">
        <h2>Prescription</h2>
        {rx && rx !== NOT_LOADED && <span className="faint">{rx.rx_number}</span>}
        <div className="grow" />
        <span className="faint">{saving || dirty ? 'Saving…' : 'Saves automatically'}</span>
      </div>
      <div className="row" style={{ marginBottom: 10 }}>
        <button className="btn small" type="button" onClick={() => setModal('templates')}>Templates</button>
        <button className="btn small" type="button" onClick={() => setModal('copy')}>Copy an older prescription</button>
        {rx && rx !== NOT_LOADED && (rx.medicines || []).length > 0 && <button className="btn small ghost" type="button" onClick={() => setModal('saveTpl')}>Save as template</button>}
      </div>
      {patient.allergies && <div className="note bad" style={{ marginBottom: 10 }}>Allergies: <b>{patient.allergies}</b></div>}

      <div className="meds">
        {meds.map((m, i) => (
          <div className={`med ${hits[i] ? 'hit' : ''}`} key={m.key}>
            <div className="med-no">{i + 1}</div>
            <div className="med-main">
              <div className="med-line1">
                <select value={m.form || 'Tab'} onChange={(e) => setMed(i, { form: e.target.value })} aria-label="Form">
                  {FORMS.map(([k, l]) => <option key={k} value={k}>{l || k}</option>)}
                </select>
                <Autocomplete value={m.name} options={medOptions} placeholder="Medicine name and strength"
                  onChange={(v) => setMed(i, { name: v })}
                  onPick={(o) => setMed(i, {
                    name: o.label, form: o.m.form || m.form || 'Tab',
                    pattern: m.pattern || o.m.default_pattern || '', timing: m.timing || o.m.default_timing || '',
                    duration: m.duration || o.m.default_duration || '',
                  })} />
              </div>
              <div className="med-line2">
                <Combo label="Dose" value={m.pattern} list={PATTERNS} placeholder="1+0+1" onChange={(v) => setMed(i, { pattern: v })} />
                <Combo label="When" value={m.timing} list={TIMINGS} placeholder="optional" onChange={(v) => setMed(i, { timing: v })} />
                <Combo label="For" value={m.duration} list={DURATIONS} placeholder="1 month" onChange={(v) => setMed(i, { duration: v })} />
                <label className="f"><span>Note</span><input value={m.note || ''} onChange={(e) => setMed(i, { note: e.target.value })} /></label>
              </div>
              {m.name && (
                <div className="med-preview">
                  {lang !== 'ur' && <span>{englishLine(m)}{m.note ? ` · ${m.note}` : ''}</span>}
                  {lang !== 'en' && <UrduLine m={m} onChange={(urdu) => setMed(i, { urdu })} />}
                </div>
              )}
              {hits[i] && <div className="error-text">Allergy warning: patient is allergic to “{hits[i]}”. Check before printing.</div>}
            </div>
            <div className="med-tools">
              <button type="button" className="btn small ghost" aria-label="Move up" disabled={i === 0}
                onClick={() => change(() => { const n = meds.slice(); [n[i - 1], n[i]] = [n[i], n[i - 1]]; setMeds(n); })}>↑</button>
              <button type="button" className="btn small ghost" aria-label="Remove medicine"
                onClick={() => change(() => setMeds(meds.length > 1 ? meds.filter((_, k) => k !== i) : [blank()]))}>✕</button>
            </div>
          </div>
        ))}
      </div>
      <button type="button" className="btn small" style={{ marginTop: 8 }} onClick={() => change(() => setMeds([...meds, blank()]))}>Add medicine</button>

      <h3 style={{ marginTop: 18 }}>Investigations advised</h3>
      <div className="chips">
        {[...new Set([...INVESTIGATIONS, ...tests])].map((t) => (
          <button type="button" key={t} className={`chip ${tests.includes(t) ? 'on' : ''}`}
            onClick={() => change(() => setTests(tests.includes(t) ? tests.filter((x) => x !== t) : [...tests, t]))}>{t}</button>
        ))}
      </div>
      <div className="row" style={{ marginTop: 6, maxWidth: 420, flexWrap: 'nowrap' }}>
        <input value={customTest} placeholder="Other test" onChange={(e) => setCustomTest(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && customTest.trim()) { e.preventDefault(); change(() => setTests([...tests, customTest.trim()])); setCustomTest(''); } }} />
        <button type="button" className="btn small" disabled={!customTest.trim()} onClick={() => { change(() => setTests([...tests, customTest.trim()])); setCustomTest(''); }}>Add</button>
      </div>

      <h3 style={{ marginTop: 18 }}>Advice</h3>
      <div className="chips" style={{ marginBottom: 6 }}>
        {ADVICE.map((a) => {
          const line = adviceLine(a, lang);
          const on = advice.split('\n').some((l) => sameAdvice(l, line));
          return (
            <button type="button" key={a[0]} className={`chip ${on ? 'on' : ''}`} onClick={() => change(() => {
              const lines = advice.split('\n').filter((l) => l.trim());
              setAdvice(on ? lines.filter((l) => !sameAdvice(l, line)).join('\n') : [...lines, line].join('\n'));
            })}>{a[0]}</button>
          );
        })}
      </div>
      <textarea rows={4} value={advice} dir="auto" onChange={(e) => change(() => setAdvice(e.target.value))} placeholder="One instruction per line (English or Urdu)" />

      {modal === 'copy' && <CopyRx patient={patient} visit={visit} onClose={() => setModal('')} onDone={reset} />}
      {modal === 'templates' && <Templates visit={visit} hasMeds={meds.some((m) => m.name)} onClose={() => setModal('')} onDone={reset} />}
      {modal === 'saveTpl' && rx && rx !== NOT_LOADED && <SaveTemplate rx={rx} visit={visit} onClose={() => setModal('')} />}
    </section>
  );
}

function UrduLine({ m, onChange }) {
  const [edit, setEdit] = useState(false);
  const auto = urduLine({ ...m, urdu: '' });
  if (edit) {
    return (
      <span className="urdu-edit">
        <input dir="rtl" lang="ur" className="urdu" autoFocus value={m.urdu || auto} onChange={(e) => onChange(e.target.value)} />
        <button type="button" className="btn small ghost" onClick={() => setEdit(false)}>Done</button>
        {m.urdu && <button type="button" className="btn small ghost" onClick={() => { onChange(''); setEdit(false); }}>Automatic</button>}
      </span>
    );
  }
  return (
    <span className="urdu-view">
      <span className="urdu" dir="rtl" lang="ur">{urduLine(m) || '-'}</span>
      <button type="button" className="btn small ghost" onClick={() => setEdit(true)}>Edit Urdu</button>
    </span>
  );
}

function Combo({ label, value, list, onChange, placeholder }) {
  const id = useMemo(() => 'dl' + Math.random().toString(36).slice(2), []);
  return (
    <label className="f"><span>{label}</span>
      <input list={id} value={value || ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      <datalist id={id}>{list.map((x) => <option key={x} value={x} />)}</datalist>
    </label>
  );
}

function CopyRx({ patient, visit, onClose, onDone }) {
  const run = useAction();
  const list = useLiveQuery(() => db().prescriptions.where('patient_id').equals(patient.id)
    .filter((r) => !r.deleted_at && r.visit_id !== visit.id).toArray(), [patient.id], []);
  return (
    <Modal title="Copy an older prescription" wide onClose={onClose}>
      <p className="muted" style={{ marginTop: 0 }}>Medicines, tests and advice are copied into this visit. The old prescription stays unchanged. Edit anything afterwards.</p>
      {!list.length && <Empty>No earlier prescriptions for this patient.</Empty>}
      <table className="t"><tbody>
        {list.sort((a, b) => b.created_at.localeCompare(a.created_at)).map((r) => (
          <tr key={r.id}>
            <td style={{ width: 120 }}>{fmtDate(r.created_at)}<div className="faint">{r.rx_number}</div></td>
            <td>{r.diagnosis && <div><b>{r.diagnosis}</b></div>}{(r.medicines || []).map((m) => `${medTitle(m)} ${m.pattern || ''}`).join(' · ')}</td>
            <td className="right"><button className="btn small primary" onClick={async () => {
              const ok = await run(() => A.copyPrescription(visit, r), 'Copied into this visit');
              if (ok) onDone();
            }}>Copy</button></td>
          </tr>
        ))}
      </tbody></table>
    </Modal>
  );
}

function Templates({ visit, hasMeds, onClose, onDone }) {
  const run = useAction();
  const list = useLiveQuery(() => db().rx_templates.filter((t) => t.active !== false).toArray(), [], []);
  async function apply(t, mode) {
    const ok = await run(async () => {
      const r = await A.applyTemplate(visit, t, mode);
      if (!visit.diagnosis && t.diagnosis) await A.saveVisitFields(visit, { diagnosis: t.diagnosis });
      return r;
    }, `Template “${t.name}” applied`);
    if (ok) onDone();
  }
  return (
    <Modal title="Prescription templates" wide onClose={onClose}>
      <p className="muted" style={{ marginTop: 0 }}>{hasMeds ? '“Use” replaces the medicines already written; “Add” keeps them and adds the new ones.' : 'Pick a template, then adjust doses for this patient.'} Edit templates in Settings → Rx templates.</p>
      {!list.length && <Empty>No templates yet. Write a prescription and use “Save as template”.</Empty>}
      <table className="t"><tbody>
        {list.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)).map((t) => (
          <tr key={t.id}>
            <td><b>{t.name}</b>{t.is_starter && <span className="badge amber" style={{ marginLeft: 6 }}>Starter - review doses</span>}
              <div className="faint">{(t.medicines || []).map((m) => `${m.name} ${m.pattern || ''}`).join(' · ')}</div></td>
            <td className="right"><div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
              {hasMeds && <button className="btn small" onClick={() => apply(t, 'add')}>Add</button>}
              <button className="btn small primary" onClick={() => apply(t, 'replace')}>Use</button>
            </div></td>
          </tr>
        ))}
      </tbody></table>
    </Modal>
  );
}

function SaveTemplate({ rx, visit, onClose }) {
  const run = useAction();
  const [name, setName] = useState(visit.diagnosis?.split(',')[0] || '');
  return (
    <Modal title="Save as template" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" onClick={async () => {
        const ok = await run(() => A.saveTemplateFromRx({ ...rx, diagnosis: visit.diagnosis || rx.diagnosis }, name), 'Template saved');
        if (ok) onClose();
      }}>Save template</button></>}>
      <Field label="Template name" hint="A template with the same name is updated."><input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Post-PCI standard" /></Field>
      <p className="faint">Saves {(rx.medicines || []).length} medicine(s), {(rx.investigations || []).length} test(s) and the advice.</p>
    </Modal>
  );
}

function FollowUp({ visit }) {
  const run = useAction();
  const appt = useLiveQuery(() => db().appointments.where('patient_id').equals(visit.patient_id)
    .filter((a) => a.source_visit_id === visit.id && a.status !== 'cancelled' && !a.deleted_at).first(), [visit.id]);
  const settings = useSettings();
  const days = settings?.followup_days?.length ? settings.followup_days : [7, 15, 30, 90];
  const [custom, setCustom] = useState('');
  const base = visit.visit_date || todayISO();
  const set = (date) => run(() => A.setFollowUp(visit, date), date ? `Follow-up booked for ${fmtDate(date)}` : 'Follow-up removed');
  const label = (n) => (n % 30 === 0 ? `${n / 30} month${n > 30 ? 's' : ''}` : n % 7 === 0 ? `${n / 7} week${n > 7 ? 's' : ''}` : `${n} days`);
  return (
    <section id="followup" className="panel section" style={{ marginTop: 14 }}>
      <div className="panel-head"><h2>Follow-up</h2></div>
      <div className="row">
        {days.map((n) => {
          const d = addDays(base, n);
          return <button type="button" key={n} className={`chip ${appt?.appt_date === d ? 'on' : ''}`} onClick={() => set(d)}>{label(n)}</button>;
        })}
        <input type="date" style={{ width: 170 }} min={addDays(base, 1)} value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="Follow-up date" />
        <button type="button" className="btn small" disabled={!custom} onClick={() => set(custom)}>Set date</button>
        {appt && <button type="button" className="btn small ghost" onClick={() => set(null)}>No follow-up</button>}
      </div>
      <p className="muted" style={{ marginBottom: 0 }}>
        {appt ? <>Next visit on <b>{fmtDate(appt.appt_date)}</b> - printed on the prescription and shown in the follow-up list for reminders.</>
          : 'No follow-up booked.'}
      </p>
    </section>
  );
}

function PrintBar({ visit }) {
  const rx = useLiveQuery(() => A.getVisitPrescription(visit.id), [visit.id]);
  return (
    <div className="print-cta no-print">
      {rx ? <>
        <span><b>Prescription {rx.rx_number}</b> <span className="faint">· {(rx.medicines || []).length} medicine(s)</span></span>
        <div className="grow" />
        <Link className="btn primary" to={`/print/rx/${rx.id}`}>Print / PDF / WhatsApp</Link>
      </> : <span className="faint">The prescription appears here to print once the first medicine or test is written.</span>}
    </div>
  );
}

// ----------------------------------------------------------------- billing
function Bill({ visit }) {
  const run = useAction();
  const services = useServices().filter((s) => s.active);
  const data = useLiveQuery(async () => {
    const inv = await A.visitInvoice(visit.id);
    if (!inv) return { inv: null };
    const [t] = await withTotals([inv]);
    const lines = await db().invoice_items.where('invoice_id').equals(inv.id).filter((l) => l.status === 'active').toArray();
    return { inv: t, lines };
  }, [visit.id]);
  const [sel, setSel] = useState(null);
  const [pay, setPay] = useState(false);
  useEffect(() => {
    if (sel === null && services.length) setSel(services.filter((s) => s.auto_add).map((s) => s.id));
  }, [services.length]); // eslint-disable-line
  if (!data) return null;
  const chosen = (sel || []).map((id) => services.find((s) => s.id === id)).filter(Boolean);
  const total = chosen.reduce((a, s) => a + Number(s.price || 0), 0);

  return (
    <section id="bill" className="panel section" style={{ marginTop: 14 }}>
      <div className="panel-head"><h2>Bill</h2>{data.inv && <span className="faint">{data.inv.invoice_number}</span>}</div>
      {!data.inv ? (
        <>
          <p className="muted" style={{ marginTop: 0 }}>No invoice yet. Tick what to charge for this visit, then create the invoice.</p>
          {!services.length && <div className="note warn">Add services and fees in Settings → Services.</div>}
          <div className="checks">
            {services.map((s) => (
              <label key={s.id} className="check">
                <input type="checkbox" checked={(sel || []).includes(s.id)}
                  onChange={(e) => setSel(e.target.checked ? [...(sel || []), s.id] : (sel || []).filter((x) => x !== s.id))} />
                <span>{s.name}<small>{s.price == null ? 'Price not set' : <Money v={s.price} />}</small></span>
              </label>
            ))}
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <span className="muted">{chosen.length} item(s) · <Money v={total} /></span>
            <div className="spacer" />
            <button className="btn primary" disabled={!chosen.length} onClick={() => run(
              () => A.createInvoice({ patientId: visit.patient_id, visit, services: chosen }), 'Invoice created')}>Create invoice</button>
          </div>
        </>
      ) : (
        <>
          <table className="t">
            <tbody>
              {data.lines.map((l) => <tr key={l.id}><td>{l.description}</td><td className="money"><Money v={l.quantity * l.unit_price} /></td></tr>)}
            </tbody>
            <tfoot>
              {data.inv.discount > 0 && <tr><td>Discount</td><td className="money">− <Money v={data.inv.discount} /></td></tr>}
              <tr><td><b>Total</b></td><td className="money"><b><Money v={data.inv.total} /></b></td></tr>
              <tr><td>Paid</td><td className="money"><Money v={data.inv.paid} /></td></tr>
              <tr><td><b>Due</b></td><td className="money" style={{ color: data.inv.due > 0 ? 'var(--red)' : 'var(--green)' }}><b><Money v={data.inv.due} /></b></td></tr>
            </tfoot>
          </table>
          <div className="row" style={{ marginTop: 10 }}>
            <Link className="btn" to={`/invoices/${data.inv.id}`}>Open invoice (add item, discount)</Link>
            <Link className="btn" to={`/print/invoice/${data.inv.id}`}>Print / WhatsApp invoice</Link>
            <div className="spacer" />
            {data.inv.due > 0 && data.inv.status !== 'void' && <button className="btn primary" onClick={() => setPay(true)}>Receive payment</button>}
          </div>
        </>
      )}
      {pay && <PaymentModal invoice={data.inv} onClose={() => setPay(false)} />}
    </section>
  );
}

export function PaymentModal({ invoice, onClose }) {
  const run = useAction();
  const nav = useNavigate();
  const [f, setF] = useState({ amount: String(invoice.due > 0 ? invoice.due : ''), method: 'cash', reference: '' });
  async function record(andPrint) {
    const p = await run(() => A.addPayment(invoice, { amount: Number(f.amount), method: f.method, reference: f.reference }), 'Payment recorded');
    if (p) { onClose(p); if (andPrint) nav(`/print/receipt/${p.id}`); }
  }
  return (
    <Modal title={`Receive payment - ${invoice.invoice_number}`} onClose={onClose} footer={<>
      <button className="btn" onClick={() => onClose()}>Cancel</button>
      <button className="btn" onClick={() => record(true)}>Record and print receipt</button>
      <button className="btn primary" onClick={() => record(false)}>Record payment</button></>}>
      <p className="muted" style={{ marginTop: 0 }}>Due now: <b><Money v={invoice.due} /></b>. Partial payments are fine.</p>
      <div className="grid g2">
        <Field label="Amount" required><input type="number" min="0" step="0.01" autoFocus value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="Method" required>
          <select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>
            {PAYMENT_METHODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
      </div>
      {f.method !== 'cash' && <div style={{ marginTop: 10 }}><Field label="Reference / transaction ID"><input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field></div>}
    </Modal>
  );
}
