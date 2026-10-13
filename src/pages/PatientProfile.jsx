import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db.js';
import { useAuth } from '../lib/auth.jsx';
import { useDoctors, useDoctorMap, usePatient, useSettings, useServices } from '../lib/hooks.js';
import { patientAccount, withTotals } from '../lib/queries.js';
import { startVisit, bookAppointment, deletePatient, cancelAppointment, createInvoice } from '../lib/actions.js';
import { updateRow } from '../lib/repo.js';
import { ageLabel, genderLabel, fmtDate, fmtDateTime, fmtTime, todayISO, waNumber } from '../lib/format.js';
import { methodLabel } from '../lib/billing.js';
import { riskLabel, historyLabel, medTitle, ANTICOAG } from '../lib/rx.js';
import { Tabs, Modal, Money, ApptBadge, DueBadge, Empty, Field, useAction, useMoney, ConfirmButton } from '../components/ui.jsx';
import { PatientForm } from '../components/patients.jsx';
import { PatientFiles } from '../components/Files.jsx';
import { LettersList } from '../components/Letters.jsx';
import TrendChart from '../components/TrendChart.jsx';
import { StudiesList, ImplantsPanel } from '../components/Studies.jsx';
import { RiskSummary } from '../components/Risk.jsx';

export function PatientHeader({ patient, children }) {
  const acct = useLiveQuery(() => patientAccount(patient.id), [patient.id]);
  const settings = useSettings();
  const m = useMoney();
  const wa = waNumber(patient.phone, settings?.phone_country_code);
  const anti = patient.anticoagulant && patient.anticoagulant !== 'none';
  return (
    <div className="pt-head">
      <div className="pt-id">
        <div className="row">
          <h1>{patient.full_name}</h1>
          {anti && <span className="badge red">On {patient.anticoagulant === 'doac' ? 'DOAC' : patient.anticoagulant}</span>}
          {patient.archived_at && <span className="badge">Archived</span>}
        </div>
        <div className="meta">
          <span className="mr">{patient.mr_number}</span>
          <span>{ageLabel(patient.dob)}{patient.dob_estimated ? ' (approx.)' : ''} · {genderLabel(patient.gender)}</span>
          {patient.guardian_name && <span>{patient.gender === 'female' ? 'd/o, w/o' : 's/o'} {patient.guardian_name}</span>}
          {patient.phone && <span>{patient.phone} {wa && <a href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer">WhatsApp</a>}</span>}
        </div>
        {(patient.risk_factors?.length > 0 || patient.cardiac_history?.length > 0) && (
          <div className="chips" style={{ marginTop: 6 }}>
            {(patient.cardiac_history || []).map((k) => <span key={k} className="badge violet">{historyLabel(k)}</span>)}
            {(patient.risk_factors || []).map((k) => <span key={k} className="badge blue">{riskLabel(k)}</span>)}
          </div>
        )}
        {patient.allergies && <div className="pt-alert">Allergies: {patient.allergies}</div>}
        {children && <div className="row" style={{ marginTop: 10 }}>{children}</div>}
      </div>
      <div className="acct">
        <div><span>Total bill</span><b className="money">{m(acct?.total)}</b></div>
        <div><span>Paid</span><b className="money">{m(acct?.paid)}</b></div>
        <div className={`due ${acct && acct.due <= 0 ? 'clear' : ''}`}><span>Due</span><b className="money">{m(acct?.due)}</b></div>
      </div>
    </div>
  );
}

export default function PatientProfile() {
  const { id } = useParams();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const { isAdmin } = useAuth();
  const patient = usePatient(id);
  const doctors = useDoctors();
  const run = useAction();
  const tab = sp.get('tab') || (isAdmin ? 'overview' : 'reports');
  const setTab = (t) => setSp({ tab: t }, { replace: true });
  const [modal, setModal] = useState('');
  const todays = useLiveQuery(() => (isAdmin ? db().visits.where('patient_id').equals(id)
    .filter((v) => v.visit_date === todayISO() && !v.deleted_at && v.status !== 'cancelled').toArray() : []), [id, isAdmin], []);

  if (patient === undefined) return null;
  if (!patient) return <Empty>Patient not found on this device. If it was just registered on another device, wait for sync.</Empty>;

  async function begin(doctorId) {
    const v = await run(() => startVisit({ patientId: id, doctorId }));
    if (v) nav(`/visits/${v.id}`);
  }
  function onStart() {
    if (!doctors.length) { nav('/settings?tab=doctors'); return; }
    if (doctors.length === 1) begin(doctors[0].id); else setModal('doctor');
  }

  const tabs = isAdmin
    ? [['overview', 'Overview'], ['visits', 'Visits'], ['rx', 'Prescriptions'], ['studies', 'Cardiac reports'], ['reports', 'Reports & files'],
      ['letters', 'Letters'], ['appointments', 'Appointments'], ['invoices', 'Invoices'], ['payments', 'Payments']]
    : [['reports', 'Reports & files'], ['appointments', 'Appointments'], ['invoices', 'Invoices'], ['payments', 'Payments']];

  return (
    <>
      <PatientHeader patient={patient}>
        {isAdmin && (todays.length
          ? todays.map((v) => <Link key={v.id} className="btn primary" to={`/visits/${v.id}`}>Continue today's visit</Link>)
          : <button className="btn primary" onClick={onStart}>New visit</button>)}
        {!isAdmin && <AddToQueue patient={patient} />}
        <button className="btn" onClick={() => setModal('book')}>Book appointment</button>
        <button className="btn" onClick={() => setModal('invoice')}>New invoice</button>
        <button className="btn" onClick={() => setModal('edit')}>Edit details</button>
        {isAdmin && !patient.deleted_at && (
          <ConfirmButton label="Delete patient" className="btn small ghost" danger title="Delete patient"
            message={`Delete ${patient.full_name} (${patient.mr_number})? The record is hidden from lists and searches, never destroyed. Blocked if there's an outstanding due or an open visit.`}
            confirmLabel="Delete patient" reason="Reason (kept on record)"
            onConfirm={async (reason) => {
              const r = await run(() => deletePatient(patient, reason), 'Patient deleted');
              if (r !== undefined) nav('/patients');
              return r !== undefined;
            }} />
        )}
      </PatientHeader>

      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'overview' && <Overview patient={patient} />}
      {tab === 'visits' && <VisitsTab id={id} />}
      {tab === 'rx' && <RxTab id={id} />}
      {tab === 'studies' && isAdmin && <div className="stack"><StudiesList patient={patient} /><ImplantsPanel patient={patient} /></div>}
      {tab === 'reports' && <PatientFiles patientId={id} />}
      {tab === 'letters' && <LettersList patient={patient} />}
      {tab === 'appointments' && <ApptsTab id={id} />}
      {tab === 'invoices' && <InvoicesTab id={id} />}
      {tab === 'payments' && <PaymentsTab id={id} />}

      {modal === 'edit' && (
        <Modal title="Edit patient" wide onClose={() => setModal('')}>
          <PatientForm initial={patient} showHistory={isAdmin} onCancel={() => setModal('')} onSaved={() => setModal('')} />
        </Modal>
      )}
      {modal === 'book' && <BookModal patient={patient} onClose={() => setModal('')} />}
      {modal === 'invoice' && <NewInvoiceModal patient={patient} onClose={() => setModal('')} />}
      {modal === 'doctor' && (
        <Modal title="Start visit with" onClose={() => setModal('')}>
          <div className="stack">{doctors.map((d) => (
            <button key={d.id} className="btn" style={{ width: '100%', justifyContent: 'flex-start' }} onClick={() => begin(d.id)}>
              {d.full_name} <span className="faint">{d.specialty}</span></button>
          ))}</div>
        </Modal>
      )}
    </>
  );
}

// Reception: put a walk-in patient in today's queue (the doctor starts the visit).
function AddToQueue({ patient }) {
  const run = useAction();
  const doctors = useDoctors();
  const today = todayISO();
  const inQueue = useLiveQuery(() => db().appointments.where('patient_id').equals(patient.id)
    .filter((a) => a.appt_date === today && !a.deleted_at && !['cancelled', 'completed'].includes(a.status)).first(), [patient.id, today]);
  if (inQueue) {
    return inQueue.status === 'waiting' ? <span className="badge amber">Waiting in today's queue</span>
      : <button className="btn primary" onClick={() => run(() => updateRow('appointments', inQueue.id, { status: 'waiting' }), 'Marked as arrived')}>Mark arrived</button>;
  }
  return (
    <button className="btn primary" disabled={!doctors.length} onClick={() => run(async () => {
      const a = await bookAppointment({ patientId: patient.id, doctorId: doctors[0].id, date: today });
      await updateRow('appointments', a.id, { status: 'waiting' });
    }, 'Added to today\'s queue')}>Add to today's queue</button>
  );
}

export function BookModal({ patient, onClose, defaultDate }) {
  const doctors = useDoctors();
  const run = useAction();
  const [f, setF] = useState({ doctorId: doctors[0]?.id || '', date: defaultDate || todayISO(), time: '', notes: '' });
  const doctorId = f.doctorId || doctors[0]?.id;
  return (
    <Modal title={`Book appointment - ${patient.full_name}`} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={!doctorId} onClick={async () => {
        const a = await run(() => bookAppointment({ patientId: patient.id, doctorId, date: f.date, time: f.time || null, notes: f.notes }), 'Appointment booked');
        if (a) onClose();
      }}>Book appointment</button></>}>
      <div className="grid g2">
        {doctors.length > 1 && (
          <Field label="Doctor" required>
            <select value={doctorId} onChange={(e) => setF({ ...f, doctorId: e.target.value })}>
              {doctors.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Date" required><input type="date" value={f.date} min={todayISO()} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Time" hint="Optional. Leave empty for walk-in order."><input type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></Field>
        <Field label="Notes"><input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
      {!doctors.length && <div className="note warn">Add the doctor in Settings first.</div>}
      <p className="faint">Booking creates an appointment only. The visit is created when the patient arrives and the doctor starts it.</p>
    </Modal>
  );
}

// Invoice without a visit (e.g. ECG only), or billing at the counter.
export function NewInvoiceModal({ patient, onClose }) {
  const run = useAction();
  const nav = useNavigate();
  const services = useServices().filter((s) => s.active);
  const [sel, setSel] = useState([]);
  const chosen = sel.map((id) => services.find((s) => s.id === id)).filter(Boolean);
  const total = chosen.reduce((a, s) => a + Number(s.price || 0), 0);
  return (
    <Modal title={`New invoice - ${patient.full_name}`} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={!chosen.length} onClick={async () => {
        const inv = await run(() => createInvoice({ patientId: patient.id, services: chosen }), 'Invoice created');
        if (inv) nav(`/invoices/${inv.id}`);
      }}>Create invoice (<Money v={total} />)</button></>}>
      <p className="muted" style={{ marginTop: 0 }}>For a visit, create the bill from inside the visit so it stays linked to it.</p>
      <div className="checks">
        {services.map((s) => (
          <label key={s.id} className="check">
            <input type="checkbox" disabled={s.price == null} checked={sel.includes(s.id)}
              onChange={(e) => setSel(e.target.checked ? [...sel, s.id] : sel.filter((x) => x !== s.id))} />
            <span>{s.name}<small>{s.price == null ? 'Price not set' : <Money v={s.price} />}</small></span>
          </label>
        ))}
      </div>
    </Modal>
  );
}

function Overview({ patient }) {
  const doctors = useDoctorMap();
  const data = useLiveQuery(async () => {
    const visits = (await db().visits.where('patient_id').equals(patient.id).toArray())
      .filter((v) => !v.deleted_at && v.status !== 'cancelled')
      .sort((a, b) => a.visit_date.localeCompare(b.visit_date) || (a.created_at || '').localeCompare(b.created_at || ''));
    const last = visits[visits.length - 1];
    const rx = last ? await db().prescriptions.where('visit_id').equals(last.id).filter((r) => !r.deleted_at).first() : null;
    const ef = [...visits].reverse().find((v) => v.echo_ef != null);
    return { visits, last, rx, ef };
  }, [patient.id], null);
  if (!data) return null;
  const rows = (f) => data.visits.map((v) => ({ date: v.visit_date, values: f(v) }));
  const inrBand = /(\d+(\.\d+)?)\s*[–-]\s*(\d+(\.\d+)?)/.exec(patient.inr_target || '');
  const anti = ANTICOAG.find((a) => a[0] === patient.anticoagulant)?.[1];

  return (
    <div className="stack">
      <div className="grid g2">
        <div className="panel">
          <h2>Cardiac summary</h2>
          <table className="t"><tbody>
            <tr><td className="muted">Cardiac history</td><td>{(patient.cardiac_history || []).map(historyLabel).join(', ') || '-'}{patient.cardiac_notes && <div>{patient.cardiac_notes}</div>}</td></tr>
            <tr><td className="muted">Risk factors</td><td>{(patient.risk_factors || []).map(riskLabel).join(', ') || '-'}</td></tr>
            <tr><td className="muted">Blood thinner</td><td>{anti || 'None'}{patient.inr_target ? ` · INR target ${patient.inr_target}` : ''}</td></tr>
            <tr><td className="muted">Latest EF</td><td>{data.ef ? `${data.ef.echo_ef}% (${fmtDate(data.ef.visit_date)})` : '-'}</td></tr>
            <tr><td className="muted">Last diagnosis</td><td>{data.last?.diagnosis || '-'}</td></tr>
            <tr><td className="muted">Allergies</td><td>{patient.allergies || 'None recorded'}</td></tr>
            <tr><td className="muted">Other history</td><td style={{ whiteSpace: 'pre-wrap' }}>{[patient.previous_diagnoses, patient.medical_history].filter(Boolean).join('\n') || '-'}</td></tr>
          </tbody></table>
        </div>
        <div className="panel">
          <div className="panel-head"><h2>Current medicines</h2>
            {data.rx && <><div className="grow" /><Link className="btn small" to={`/print/rx/${data.rx.id}`}>Last prescription</Link></>}</div>
          {data.rx?.medicines?.length
            ? <ol className="lv-meds">{data.rx.medicines.map((m, i) => <li key={i}><b>{medTitle(m)}</b> <span className="faint">{m.pattern}{m.timing ? ` · ${m.timing}` : ''}</span></li>)}</ol>
            : <p className="muted" style={{ whiteSpace: 'pre-wrap' }}>{patient.current_medicines || 'No prescription yet.'}</p>}
          {data.last && <p className="faint">From visit on {fmtDate(data.last.visit_date)} with {doctors[data.last.doctor_id]?.full_name || 'doctor'}.</p>}
        </div>
      </div>
      <ImplantsPanel patient={patient} />
      <RiskSummary visits={data.visits} />
      {data.visits.length > 0 && (
        <div className="panel">
          <h2>Trends across visits</h2>
          <div className="trends">
            <TrendChart title="Blood pressure" unit="mmHg" rows={rows((v) => [v.bp_systolic, v.bp_diastolic])}
              series={[{ name: 'Systolic', cls: 's1' }, { name: 'Diastolic', cls: 's2' }]} band={[80, 130]} />
            <TrendChart title="Pulse" unit="/min" rows={rows((v) => [v.pulse])} series={[{ name: 'Pulse', cls: 's1' }]} band={[60, 100]} />
            <TrendChart title="Weight" unit="kg" rows={rows((v) => [v.weight_kg])} series={[{ name: 'Weight', cls: 's1' }]} />
            <TrendChart title="INR" unit="" rows={rows((v) => [v.inr])} series={[{ name: 'INR', cls: 's1' }]}
              band={inrBand ? [Number(inrBand[1]), Number(inrBand[3])] : undefined} />
            <TrendChart title="Ejection fraction" unit="%" rows={rows((v) => [v.echo_ef])} series={[{ name: 'EF', cls: 's1' }]} />
          </div>
        </div>
      )}
      <div className="panel">
        <h2>Contact</h2>
        <table className="t"><tbody>
          <tr><td className="muted">Address</td><td>{patient.address || '-'}</td></tr>
          <tr><td className="muted">Date of birth</td><td>{fmtDate(patient.dob)}{patient.dob_estimated ? ' (estimated from age)' : ''}</td></tr>
          {patient.cnic && <tr><td className="muted">CNIC</td><td>{patient.cnic}</td></tr>}
          <tr><td className="muted">Registered</td><td>{fmtDate(patient.created_at)}</td></tr>
        </tbody></table>
        {patient.archived_at && (
          <button className="btn small" style={{ marginTop: 10 }} onClick={() => updateRow('patients', patient.id, { archived_at: null })}>Restore to active patients</button>
        )}
      </div>
    </div>
  );
}

function VisitsTab({ id }) {
  const nav = useNavigate();
  const data = useLiveQuery(async () => {
    const visits = (await db().visits.where('patient_id').equals(id).toArray()).filter((v) => !v.deleted_at);
    const rxs = await db().prescriptions.where('patient_id').equals(id).filter((r) => !r.deleted_at).toArray();
    return { visits, rx: Object.fromEntries(rxs.map((r) => [r.visit_id, r])) };
  }, [id], { visits: [], rx: {} });
  return (
    <div className="panel table-wrap">
      <table className="t">
        <thead><tr><th>Visit</th><th>Date</th><th>BP / pulse</th><th>Complaint / diagnosis</th><th>Status</th><th /></tr></thead>
        <tbody>
          {data.visits.sort((a, b) => b.visit_date.localeCompare(a.visit_date) || (b.created_at || '').localeCompare(a.created_at || '')).map((v, i, arr) => (
            <tr key={v.id} className="click" onClick={() => nav(`/visits/${v.id}`)}>
              <td><b>Visit {arr.length - i}</b><div className="faint">{v.visit_number}</div></td>
              <td>{fmtDate(v.visit_date)}</td>
              <td>{v.bp_systolic ? `${v.bp_systolic}/${v.bp_diastolic}` : '-'}{v.pulse ? ` · ${v.pulse}` : ''}</td>
              <td>{v.chief_complaint}{v.diagnosis && <div className="faint">Dx: {v.diagnosis}</div>}</td>
              <td><span className={`badge ${v.status === 'open' ? 'amber' : v.status === 'completed' ? 'green' : ''}`}>{v.status === 'open' ? 'Open' : v.status === 'completed' ? 'Completed' : 'Cancelled'}</span></td>
              <td className="right" onClick={(e) => e.stopPropagation()}>{data.rx[v.id] && <Link className="btn small" to={`/print/rx/${data.rx[v.id].id}`}>Prescription</Link>}</td>
            </tr>
          ))}
          {!data.visits.length && <tr><td colSpan="6" className="empty">No visits yet. Use “New visit” when the patient is seen.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function ApptsTab({ id }) {
  const doctors = useDoctorMap();
  const run = useAction();
  const appts = useLiveQuery(() => db().appointments.where('patient_id').equals(id).filter((a) => !a.deleted_at).toArray(), [id], []);
  const cancellable = (a) => !['cancelled', 'completed'].includes(a.status);
  return (
    <div className="panel table-wrap">
      <table className="t">
        <thead><tr><th>Date</th><th>Time</th><th>Doctor</th><th>Type</th><th>Status</th><th /></tr></thead>
        <tbody>
          {appts.sort((a, b) => b.appt_date.localeCompare(a.appt_date)).map((a) => (
            <tr key={a.id}>
              <td>{fmtDate(a.appt_date)}</td><td>{fmtTime(a.appt_time) || '-'}</td>
              <td>{doctors[a.doctor_id]?.full_name}</td>
              <td>{a.kind === 'follow_up' ? 'Follow-up' : 'New'}</td><td><ApptBadge s={a.status} /></td>
              <td className="right">{cancellable(a) &&
                <ConfirmButton label="Cancel" className="btn small ghost" title="Cancel appointment"
                  message={`Cancel the appointment on ${fmtDate(a.appt_date)}?`} confirmLabel="Cancel appointment"
                  onConfirm={() => run(() => cancelAppointment(a), 'Appointment cancelled')} />}</td>
            </tr>
          ))}
          {!appts.length && <tr><td colSpan="6" className="empty">No appointments.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function RxTab({ id }) {
  const rxs = useLiveQuery(() => db().prescriptions.where('patient_id').equals(id).filter((r) => !r.deleted_at).toArray(), [id], []);
  return (
    <div className="panel table-wrap">
      <table className="t">
        <thead><tr><th>Prescription</th><th>Date</th><th>Diagnosis</th><th>Medicines</th><th></th></tr></thead>
        <tbody>
          {rxs.sort((a, b) => b.created_at.localeCompare(a.created_at)).map((r) => (
            <tr key={r.id}>
              <td>{r.rx_number}</td><td>{fmtDate(r.created_at)}</td><td>{r.diagnosis}</td>
              <td>{(r.medicines || []).map((m) => m.name).join(', ')}</td>
              <td className="right"><Link className="btn small" to={`/print/rx/${r.id}`}>Print / PDF / WhatsApp</Link></td>
            </tr>
          ))}
          {!rxs.length && <tr><td colSpan="5" className="empty">No prescriptions.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function InvoicesTab({ id }) {
  const nav = useNavigate();
  const invs = useLiveQuery(async () => withTotals(await db().invoices.where('patient_id').equals(id).toArray()), [id], []);
  return (
    <div className="panel table-wrap">
      <table className="t">
        <thead><tr><th>Invoice</th><th>Date</th><th className="money">Total</th><th className="money">Paid</th><th className="money">Due</th><th></th></tr></thead>
        <tbody>
          {invs.sort((a, b) => b.invoice_date.localeCompare(a.invoice_date)).map((i) => (
            <tr key={i.id} className="click" onClick={() => nav(`/invoices/${i.id}`)}>
              <td>{i.invoice_number}</td><td>{fmtDate(i.invoice_date)}</td>
              <td className="money"><Money v={i.total} /></td><td className="money"><Money v={i.paid} /></td><td className="money"><Money v={i.due} /></td>
              <td className="right"><DueBadge due={i.due} isVoid={i.status === 'void'} /></td>
            </tr>
          ))}
          {!invs.length && <tr><td colSpan="6" className="empty">No invoices. An invoice is made only when you press “Create invoice”.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function PaymentsTab({ id }) {
  const pays = useLiveQuery(() => db().payments.where('patient_id').equals(id).toArray(), [id], []);
  const invs = useLiveQuery(() => db().invoices.where('patient_id').equals(id).toArray(), [id], []);
  const invNo = Object.fromEntries(invs.map((i) => [i.id, i.invoice_number]));
  return (
    <div className="panel table-wrap">
      <table className="t">
        <thead><tr><th>Receipt</th><th>Date</th><th>Invoice</th><th>Method</th><th className="money">Amount</th><th></th></tr></thead>
        <tbody>
          {pays.sort((a, b) => b.received_at.localeCompare(a.received_at)).map((p) => (
            <tr key={p.id}>
              <td>{p.payment_number}</td><td>{fmtDateTime(p.received_at)}</td>
              <td><Link to={`/invoices/${p.invoice_id}`}>{invNo[p.invoice_id]}</Link></td>
              <td>{methodLabel(p.method)}{p.kind === 'reversal' && <span className="badge red" style={{ marginLeft: 6 }}>Reversal</span>}</td>
              <td className="money"><Money v={p.amount} /></td>
              <td className="right">{p.kind === 'payment' && <Link className="btn small" to={`/print/receipt/${p.id}`}>Receipt</Link>}</td>
            </tr>
          ))}
          {!pays.length && <tr><td colSpan="6" className="empty">No payments yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
