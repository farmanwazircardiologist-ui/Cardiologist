import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db.js';
import { createLetter, getVisitPrescription } from '../lib/actions.js';
import { useDoctors } from '../lib/hooks.js';
import { LETTER_KINDS, letterTitle, letterDraft } from '../lib/rx.js';
import { fmtDate, todayISO, addDays } from '../lib/format.js';
import { Field, Modal, Empty, useAction } from './ui.jsx';

export function LettersList({ patient, visit = null, compact = false }) {
  const [kind, setKind] = useState(null);
  const letters = useLiveQuery(() => db().letters.where('patient_id').equals(patient.id)
    .filter((l) => !l.deleted_at && (!visit || l.visit_id === visit.id)).toArray(), [patient.id, visit?.id], []);
  return (
    <div className={compact ? '' : 'panel'}>
      <div className="panel-head">
        {!compact && <h2>Letters & certificates</h2>}
        <div className="grow" />
        <div className="row">
          {LETTER_KINDS.map(([k, l]) => <button type="button" key={k} className="btn small" onClick={() => setKind(k)}>{l}</button>)}
        </div>
      </div>
      {!letters.length && <Empty>{visit ? 'No letter made in this visit.' : 'No letters or certificates yet.'}</Empty>}
      {letters.length > 0 && (
        <table className="t"><tbody>
          {letters.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')).map((l) => (
            <tr key={l.id}>
              <td><b>{letterTitle(l.kind)}</b><div className="faint">{l.letter_number}{l.addressed_to ? ` · ${l.addressed_to}` : ''}</div></td>
              <td>{fmtDate(l.letter_date)}</td>
              <td className="right"><Link className="btn small" to={`/print/letter/${l.id}`}>Print / PDF / WhatsApp</Link></td>
            </tr>
          ))}
        </tbody></table>
      )}
      {kind && <LetterModal kind={kind} patient={patient} visit={visit} onClose={() => setKind(null)} />}
    </div>
  );
}

export function LetterModal({ kind, patient, visit, onClose }) {
  const nav = useNavigate();
  const run = useAction();
  const doctors = useDoctors();
  const doctor = doctors.find((d) => d.id === visit?.doctor_id) || doctors[0];
  const rx = useLiveQuery(() => (visit ? getVisitPrescription(visit.id) : null), [visit?.id]);
  const [f, setF] = useState(() => ({
    addressed_to: kind === 'referral' ? '' : 'To whom it may concern',
    diagnosis: visit?.diagnosis || '',
    from_date: todayISO(), days: '3', body: '', touched: false,
  }));
  const to = kind === 'sick_leave' && Number(f.days) > 0 ? addDays(f.from_date, Number(f.days) - 1) : null;
  const draft = letterDraft(kind, {
    patient, visit, rx, doctor,
    from: kind === 'sick_leave' ? fmtDate(f.from_date) : null, to: to ? fmtDate(to) : null,
  });
  const body = f.touched ? f.body : draft;
  async function save() {
    const l = await run(() => createLetter({
      patient, visit, doctor, kind, addressed_to: f.addressed_to, diagnosis: f.diagnosis, body,
      from_date: kind === 'sick_leave' ? f.from_date : null, to_date: to,
    }), 'Saved');
    if (l) nav(`/print/letter/${l.id}`);
  }
  return (
    <Modal wide title={letterTitle(kind)} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" onClick={save}>Save and print</button></>}>
      <div className="grid g2">
        <Field label={kind === 'referral' ? 'Referred to' : 'Addressed to'} hint={kind === 'referral' ? 'e.g. Dr. …, Cardiac Surgeon, … Hospital' : ''}>
          <input value={f.addressed_to} onChange={(e) => setF({ ...f, addressed_to: e.target.value })} />
        </Field>
        <Field label="Diagnosis"><input value={f.diagnosis} onChange={(e) => setF({ ...f, diagnosis: e.target.value })} /></Field>
        {kind === 'sick_leave' && <>
          <Field label="Rest from"><input type="date" value={f.from_date} onChange={(e) => setF({ ...f, from_date: e.target.value })} /></Field>
          <Field label="Number of days"><input type="number" min="1" max="90" value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} /></Field>
        </>}
      </div>
      <div style={{ marginTop: 10 }}>
        <Field label="Letter text" hint={f.touched ? '' : 'Written from this visit automatically. Edit anything before saving.'}>
          <textarea rows={9} value={body} onChange={(e) => setF({ ...f, body: e.target.value, touched: true })} />
        </Field>
        {f.touched && <button type="button" className="btn small ghost" onClick={() => setF({ ...f, touched: false })}>Rewrite from visit</button>}
      </div>
    </Modal>
  );
}
