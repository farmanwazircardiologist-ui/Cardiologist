import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db.js';
import { updateRow } from '../lib/repo.js';
import { startVisit } from '../lib/actions.js';
import { patientMap } from '../lib/queries.js';
import { useDoctorMap, useDoctors } from '../lib/hooks.js';
import { addDays, fmtDate, fmtTime, todayISO } from '../lib/format.js';
import { ApptBadge, APPT_LABEL, Modal, useAction, Empty } from '../components/ui.jsx';
import { PatientPicker } from '../components/patients.jsx';
import { BookModal } from './PatientProfile.jsx';
import { useAuth } from '../lib/auth.jsx';
import { RemindButton } from './Dashboard.jsx';

export default function Appointments() {
  const [sp, setSp] = useSearchParams();
  const [date, setDate] = useState(todayISO());
  const [doctorId, setDoctorId] = useState('');
  const [picking, setPicking] = useState(sp.get('new') === '1');
  const [patient, setPatient] = useState(null);
  const doctors = useDoctors();
  const dmap = useDoctorMap();
  const { isAdmin } = useAuth();
  const nav = useNavigate();
  const run = useAction();
  const data = useLiveQuery(async () => {
    const list = (await db().appointments.where('appt_date').equals(date).filter((a) => !a.deleted_at).toArray())
      .filter((a) => !doctorId || a.doctor_id === doctorId)
      .sort((a, b) => (a.appt_time || '99').localeCompare(b.appt_time || '99'));
    return { list, pts: await patientMap(list.map((a) => a.patient_id)) };
  }, [date, doctorId], { list: [], pts: {} });

  async function arrive(a) {
    // The visit is created here - when the patient actually arrives.
    const v = await run(() => startVisit({ patientId: a.patient_id, doctorId: a.doctor_id || doctors[0]?.id, appointmentId: a.id }));
    if (v) nav(`/visits/${v.id}`);
  }

  return (
    <>
      <div className="page-head">
        <h1>Appointments</h1>
        <div className="grow" />
        <button className="btn primary" onClick={() => setPicking(true)}>Book appointment</button>
      </div>
      <div className="panel">
        <div className="row" style={{ marginBottom: 12 }}>
          <button className="btn small" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">Previous</button>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value || todayISO())} style={{ width: 170 }} />
          <button className="btn small" onClick={() => setDate(addDays(date, 1))} aria-label="Next day">Next</button>
          {date !== todayISO() && <button className="btn small ghost" onClick={() => setDate(todayISO())}>Today</button>}
          <b style={{ marginLeft: 8 }}>{fmtDate(date)}</b>
          <div className="spacer" />
          {doctors.length > 1 && (
            <select value={doctorId} onChange={(e) => setDoctorId(e.target.value)} style={{ width: 200 }}>
              <option value="">All doctors</option>
              {doctors.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
            </select>
          )}
        </div>
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Time</th><th>Patient</th><th>Doctor</th><th>Type</th><th>Status</th><th /></tr></thead>
            <tbody>
              {data.list.map((a) => {
                const p = data.pts[a.patient_id];
                return (
                  <tr key={a.id}>
                    <td>{fmtTime(a.appt_time) || '-'}</td>
                    <td><Link to={`/patients/${a.patient_id}`}><b>{p?.full_name}</b></Link><div className="faint">{p?.mr_number} · {p?.phone}</div></td>
                    <td>{dmap[a.doctor_id]?.full_name}</td>
                    <td>{a.kind === 'follow_up' ? 'Follow-up' : 'New'}</td>
                    <td>
                      <select value={a.status} style={{ width: 150 }} disabled={a.status === 'completed'}
                        onChange={(e) => run(() => updateRow('appointments', a.id, { status: e.target.value }))}>
                        {Object.entries(APPT_LABEL).filter(([k]) => k !== 'in_consultation' || a.status === k).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </select>
                    </td>
                    <td className="right">
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        {p && !['completed', 'cancelled'].includes(a.status) && a.appt_date >= todayISO() && <RemindButton patient={p} appt={a} />}
                        {a.visit_id
                          ? isAdmin && <Link className="btn small" to={`/visits/${a.visit_id}`}>Open visit</Link>
                          : isAdmin && !['cancelled', 'completed'].includes(a.status) && a.appt_date <= todayISO() &&
                            <button className="btn small primary" onClick={() => arrive(a)}>Start visit</button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!data.list.length && <Empty>No appointments on this day.</Empty>}
        </div>
      </div>
      {picking && !patient && (
        <Modal title="Book appointment - choose patient" wide onClose={() => { setPicking(false); setSp({}); }}>
          <PatientPicker onPick={(p) => setPatient(p)} />
        </Modal>
      )}
      {patient && <BookModal patient={patient} defaultDate={date < todayISO() ? todayISO() : date}
        onClose={() => { setPatient(null); setPicking(false); setSp({}); }} />}
    </>
  );
}
