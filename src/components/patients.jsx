import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db.js';
import { registerPatient, findPossibleDuplicates, searchPatients } from '../lib/actions.js';
import { updateRow } from '../lib/repo.js';
import { ageLabel, dobFromAge, genderLabel, fmtDate } from '../lib/format.js';
import { Field, Modal, useAction, KeyChips } from './ui.jsx';
import { RISK_FACTORS, CARDIAC_HISTORY, ANTICOAG } from '../lib/rx.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const CUR_YEAR = new Date().getFullYear();
const daysInMonth = (y, m) => new Date(y, m, 0).getDate(); // m is 1-based

// Day / Month / Year dropdowns instead of a native date picker - far fewer
// clicks to reach a birth year decades back, and works the same on every
// device. `value` is a YYYY-MM-DD string or ''.
function DobDropdowns({ value, onChange }) {
  const [y, m, d] = value ? value.split('-').map(Number) : ['', '', ''];
  const set = (ny, nm, nd) => {
    if (!ny || !nm || !nd) { onChange(''); return; }
    const dd = Math.min(nd, daysInMonth(ny, nm));
    onChange(`${ny}-${String(nm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`);
  };
  const days = Array.from({ length: y && m ? daysInMonth(y, m) : 31 }, (_, i) => i + 1);
  return (
    <div className="row" style={{ flexWrap: 'nowrap' }}>
      <select value={d || ''} onChange={(e) => set(y, m, Number(e.target.value))} aria-label="Day">
        <option value="">Day</option>{days.map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
      <select value={m || ''} onChange={(e) => set(y, Number(e.target.value), d || 1)} aria-label="Month">
        <option value="">Month</option>{MONTHS.map((name, i) => <option key={name} value={i + 1}>{name}</option>)}
      </select>
      <select value={y || ''} onChange={(e) => set(Number(e.target.value), m || 1, d || 1)} aria-label="Year">
        <option value="">Year</option>{Array.from({ length: 130 }, (_, i) => CUR_YEAR - i).map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
    </div>
  );
}

export function PatientForm({ initial = {}, onSaved, onCancel, showHistory = false }) {
  const [f, setF] = useState(() => ({
    full_name: '', guardian_name: '', phone: '', gender: '', dob: '', address: '', cnic: '', allergies: '',
    current_medicines: '', previous_diagnoses: '', medical_history: '',
    risk_factors: [], cardiac_history: [], cardiac_notes: '', anticoagulant: 'none', inr_target: '', ...initial,
    age: initial.dob && initial.dob_estimated ? String(Math.floor((Date.now() - new Date(initial.dob)) / 31557600000)) : '',
    ageMode: initial.dob && !initial.dob_estimated ? 'dob' : 'age',
  }));
  const [dups, setDups] = useState(null);
  const [err, setErr] = useState('');
  const run = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  function validate() {
    if (!f.full_name.trim()) return 'Enter the patient name.';
    if (!f.gender) return 'Select gender.';
    if (f.ageMode === 'dob' && !f.dob) return 'Enter date of birth, or switch to age.';
    if (f.ageMode === 'age' && (f.age === '' || dobFromAge(f.age) === null)) return 'Enter age in years (0–130).';
    if (f.ageMode === 'dob' && f.dob > new Date().toISOString().slice(0, 10)) return 'Date of birth cannot be in the future.';
    if (f.phone && f.phone.replace(/\D/g, '').length < 7) return 'Phone number looks too short.';
    return '';
  }

  async function save(force = false) {
    const e = validate();
    setErr(e);
    if (e) return;
    const data = {
      full_name: f.full_name.trim(), guardian_name: f.guardian_name?.trim() || null, phone: (f.phone || '').trim() || null, gender: f.gender,
      dob: f.ageMode === 'dob' ? f.dob : dobFromAge(f.age), dob_estimated: f.ageMode === 'age',
      address: f.address || null, cnic: f.cnic?.trim() || null, allergies: f.allergies || null,
    };
    if (showHistory) Object.assign(data, {
      current_medicines: f.current_medicines || null, previous_diagnoses: f.previous_diagnoses || null,
      medical_history: f.medical_history || null,
      risk_factors: f.risk_factors || [], cardiac_history: f.cardiac_history || [],
      cardiac_notes: f.cardiac_notes?.trim() || null, anticoagulant: f.anticoagulant || 'none',
      inr_target: f.anticoagulant === 'warfarin' ? (f.inr_target?.trim() || null) : null,
    });
    if (initial.id) {
      const p = await run(() => updateRow('patients', initial.id, data), 'Patient details saved');
      if (p) onSaved?.(p);
      return;
    }
    if (!force) {
      const d = await findPossibleDuplicates(data);
      if (d.length) { setDups(d); return; }
    }
    const p = await run(() => registerPatient(data), 'Patient registered');
    if (p) onSaved?.(p);
  }

  return (
    <div className="stack">
      <div className="grid g2">
        <Field label="Full name" required><input autoFocus value={f.full_name} onChange={set('full_name')} /></Field>
        <Field label="Father / husband name" hint="Optional, printed as s/o, d/o, w/o"><input value={f.guardian_name || ''} onChange={set('guardian_name')} /></Field>
        <Field label="Phone / WhatsApp"><input inputMode="tel" value={f.phone || ''} onChange={set('phone')} placeholder="03xx xxxxxxx" /></Field>
        <Field label="CNIC" hint="Optional"><input inputMode="numeric" value={f.cnic || ''} onChange={set('cnic')} placeholder="xxxxx-xxxxxxx-x" /></Field>
        <Field label="Gender" required>
          <select value={f.gender || ''} onChange={set('gender')}>
            <option value="">Select…</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option>
          </select>
        </Field>
        <Field label={f.ageMode === 'dob' ? 'Date of birth' : 'Age (years)'} required>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            {f.ageMode === 'dob'
              ? <DobDropdowns value={f.dob || ''} onChange={(v) => setF({ ...f, dob: v })} />
              : <input type="number" min="0" max="130" value={f.age} onChange={set('age')} />}
            <button type="button" className="btn small ghost" onClick={() => setF({ ...f, ageMode: f.ageMode === 'dob' ? 'age' : 'dob' })}>
              {f.ageMode === 'dob' ? 'Use age' : 'Use DOB'}
            </button>
          </div>
        </Field>
      </div>
      <Field label="Address"><input value={f.address || ''} onChange={set('address')} /></Field>
      <Field label="Allergies" hint="Separate with commas. The prescription warns if a medicine matches."><input value={f.allergies || ''} onChange={set('allergies')} placeholder="e.g. Aspirin, Penicillin" /></Field>
      {showHistory && (
        <div className="cardiac-box stack">
          <h3 style={{ margin: 0 }}>Cardiac profile</h3>
          <Field label="Risk factors"><KeyChips list={RISK_FACTORS} value={f.risk_factors} onChange={(v) => setF({ ...f, risk_factors: v })} /></Field>
          <Field label="Cardiac history"><KeyChips list={CARDIAC_HISTORY} value={f.cardiac_history} onChange={(v) => setF({ ...f, cardiac_history: v })} /></Field>
          <Field label="Details" hint="e.g. PCI to LAD 2023 (DES × 1), CABG × 3 in 2019, mechanical MVR"><input value={f.cardiac_notes || ''} onChange={set('cardiac_notes')} /></Field>
          <div className="grid g2">
            <Field label="Blood thinner (anticoagulant)">
              <select value={f.anticoagulant || 'none'} onChange={set('anticoagulant')}>
                {ANTICOAG.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </Field>
            {f.anticoagulant === 'warfarin' && <Field label="INR target"><input value={f.inr_target || ''} onChange={set('inr_target')} placeholder="2.0 – 3.0" /></Field>}
          </div>
        </div>
      )}
      {showHistory && (
        <div className="grid g2">
          <Field label="Current medicines"><textarea value={f.current_medicines || ''} onChange={set('current_medicines')} /></Field>
          <Field label="Previous diagnoses"><textarea value={f.previous_diagnoses || ''} onChange={set('previous_diagnoses')} /></Field>
          <Field label="Medical history"><textarea value={f.medical_history || ''} onChange={set('medical_history')} /></Field>
        </div>
      )}
      {err && <div className="error-text">{err}</div>}
      {dups && (
        <div className="note warn">
          <b>This patient may already be registered.</b> Open the existing record to avoid a duplicate:
          <div className="stack" style={{ marginTop: 8 }}>
            {dups.map((d) => (
              <div key={d.id} className="row">
                <span><b>{d.full_name}</b> · {d.mr_number} · {d.phone} · {ageLabel(d.dob)} {genderLabel(d.gender)}</span>
                <span className="spacer" />
                <button className="btn small primary" onClick={() => onSaved?.(d)}>Use this patient</button>
              </div>
            ))}
          </div>
          <button className="btn small" style={{ marginTop: 8 }} onClick={() => save(true)}>No, register as a new patient</button>
        </div>
      )}
      <div className="modal-foot">
        {onCancel && <button className="btn" onClick={onCancel}>Cancel</button>}
        <button className="btn primary" onClick={() => save(false)}>{initial.id ? 'Save changes' : 'Register patient'}</button>
      </div>
    </div>
  );
}

// Search an existing patient, or register a new one.
export function PatientPicker({ onPick, autoFocus = true, showHistory = false }) {
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const all = useLiveQuery(() => db().patients.toArray(), [], []);
  const results = q.trim() ? searchPatients(all, q).slice(0, 8) : [];
  const looksLikePhone = /^[\d\s+-]+$/.test(q.trim());
  return (
    <div className="stack">
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <div className="search" style={{ flex: 1 }}>
          <input autoFocus={autoFocus} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, MR number or phone" />
        </div>
        <button className="btn primary" onClick={() => setAdding(true)}>New patient</button>
      </div>
      {q.trim() && (
        <div className="table-wrap">
          <table className="t">
            <tbody>
              {results.map((p) => (
                <tr key={p.id} className="click" onClick={() => onPick(p)}>
                  <td><b>{p.full_name}</b><div className="faint">{p.mr_number}</div></td>
                  <td>{p.phone}</td>
                  <td>{ageLabel(p.dob)} {genderLabel(p.gender)}</td>
                  <td className="faint">Since {fmtDate(p.created_at)}</td>
                </tr>
              ))}
              {!results.length && <tr><td className="empty">No patient found. Use “New patient” to register.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {adding && (
        <Modal title="Register patient" onClose={() => setAdding(false)} wide>
          <PatientForm showHistory={showHistory}
            initial={looksLikePhone ? { phone: q.trim() } : { full_name: q.trim() }}
            onCancel={() => setAdding(false)}
            onSaved={(p) => { setAdding(false); onPick(p); }} />
        </Modal>
      )}
    </div>
  );
}

export function patientLine(p) {
  if (!p) return '';
  return [p.mr_number, ageLabel(p.dob) + (p.dob_estimated ? ' (approx.)' : ''), genderLabel(p.gender), p.phone].filter(Boolean).join(' · ');
}
