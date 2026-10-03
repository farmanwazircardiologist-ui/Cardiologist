import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db.js';
import { useAuth } from '../lib/auth.jsx';
import { withTotals, patientMap } from '../lib/queries.js';
import { todayISO, addDays, fmtTime, fmtDate, waNumber } from '../lib/format.js';
import { updateRow } from '../lib/repo.js';
import { startVisit, markReminded } from '../lib/actions.js';
import { useDoctors, useSettings } from '../lib/hooks.js';
import { ApptBadge, useMoney, useAction } from '../components/ui.jsx';

// WhatsApp reminder text, English + Urdu.
export function reminderText(p, a, settings) {
  const clinic = settings?.clinic_name || 'the clinic';
  const when = `${fmtDate(a.appt_date)}${a.appt_time ? ` ${fmtTime(a.appt_time)}` : ''}`;
  return `Assalam o Alaikum ${p?.full_name || ''},\nReminder: your ${a.kind === 'follow_up' ? 'follow-up ' : ''}visit at ${clinic} is on ${when}. Please bring your reports and medicines.\n\nیاد دہانی: ${clinic} میں آپ کا معائنہ ${when} کو ہے۔ براہِ کرم اپنی رپورٹس اور دوائیں ساتھ لائیں۔`;
}

export function RemindButton({ patient, appt, small = true }) {
  const settings = useSettings();
  const run = useAction();
  const wa = waNumber(patient?.phone, settings?.phone_country_code);
  if (!wa) return <span className="faint">No phone</span>;
  return (
    <a className={`btn ${small ? 'small' : ''}`} target="_blank" rel="noreferrer"
      href={`https://wa.me/${wa}?text=${encodeURIComponent(reminderText(patient, appt, settings))}`}
      onClick={() => run(() => markReminded(appt))}>
      {appt.reminded_at ? 'Remind again' : 'WhatsApp reminder'}
    </a>
  );
}

export default function Dashboard() {
  const today = todayISO();
  const nav = useNavigate();
  const m = useMoney();
  const run = useAction();
  const { isAdmin } = useAuth();
  const doctors = useDoctors();
  const d = useLiveQuery(async () => {
    const [visits, appts, invs, pays] = await Promise.all([
      db().visits.where('visit_date').equals(today).filter((v) => !v.deleted_at && v.status !== 'cancelled').toArray(),
      db().appointments.where('appt_date').between(addDays(today, -30), addDays(today, 7), true, true).filter((a) => !a.deleted_at).toArray(),
      db().invoices.filter((i) => i.status !== 'void').toArray(),
      db().payments.toArray(),
    ]);
    const all = await withTotals(invs);
    const isToday = (ts) => ts && new Date(ts).toDateString() === new Date().toDateString();
    const todayAppts = appts.filter((a) => a.appt_date === today && a.status !== 'cancelled');
    const upcoming = appts.filter((a) => a.appt_date > today && a.kind === 'follow_up' && !['cancelled', 'completed'].includes(a.status))
      .sort((a, b) => a.appt_date.localeCompare(b.appt_date));
    const missed = appts.filter((a) => a.appt_date < today && a.kind === 'follow_up' && !a.visit_id && !['cancelled', 'completed'].includes(a.status))
      .sort((a, b) => b.appt_date.localeCompare(a.appt_date));
    // walk-ins seen today without an appointment still belong in the queue
    const linked = new Set(todayAppts.map((a) => a.visit_id).filter(Boolean));
    const walkIns = visits.filter((v) => !linked.has(v.id));
    const unpaid = all.filter((i) => i.invoice_date === today && i.due > 0);
    const pts = await patientMap([...todayAppts, ...upcoming, ...missed, ...walkIns, ...unpaid].map((x) => x.patient_id));
    return {
      pts, todayAppts, upcoming, missed, walkIns, unpaid,
      waiting: todayAppts.filter((a) => a.status === 'waiting').length,
      patientsToday: new Set([...visits.map((v) => v.patient_id), ...todayAppts.map((a) => a.patient_id)]).size,
      seen: visits.filter((v) => v.status === 'completed').length,
      collected: pays.filter((p) => isToday(p.received_at)).reduce((s, p) => s + Number(p.amount), 0),
      billed: all.filter((i) => i.invoice_date === today).reduce((s, i) => s + i.total, 0),
      outstanding: all.reduce((s, i) => s + Math.max(i.due, 0), 0),
    };
  }, [today]);
  if (!d) return null;

  async function start(a) {
    const v = await run(() => startVisit({ patientId: a.patient_id, doctorId: a.doctor_id || doctors[0]?.id, appointmentId: a.id }));
    if (v) nav(`/visits/${v.id}`);
  }
  const order = { waiting: 0, in_consultation: 1, confirmed: 2, scheduled: 3, completed: 4 };
  const queue = [...d.todayAppts].sort((a, b) => (order[a.status] ?? 5) - (order[b.status] ?? 5) || (a.appt_time || '99').localeCompare(b.appt_time || '99'));

  return (
    <>
      <div className="page-head">
        <h1>Today, {fmtDate(today)}</h1>
        <div className="grow" />
        <Link className="btn" to="/appointments?new=1">Book appointment</Link>
        <Link className="btn primary" to="/patients?new=1">New patient</Link>
      </div>
      <div className="stats">
        <div className={`stat ${d.waiting ? 'warn' : ''}`}><b>{d.waiting}</b><span>Waiting now</span></div>
        <div className="stat"><b>{d.patientsToday}</b><span>Patients today</span></div>
        <div className="stat"><b>{d.seen}</b><span>Seen</span></div>
        <div className="stat"><b className="money">{m(d.collected)}</b><span>Collected today</span></div>
        <div className="stat"><b className="money">{m(d.billed)}</b><span>Billed today</span></div>
        <Link className={`stat ${d.outstanding > 0 ? 'bad' : ''}`} to="/billing?due=1"><b className="money">{m(d.outstanding)}</b><span>Outstanding dues</span></Link>
      </div>

      <div className="grid g2">
        <div className="panel">
          <div className="panel-head"><h2>Today's queue</h2><div className="grow" /><Link to="/appointments">All appointments</Link></div>
          <table className="t"><tbody>
            {queue.map((a) => (
              <tr key={a.id}>
                <td style={{ width: 70 }}>{fmtTime(a.appt_time) || 'Walk-in'}</td>
                <td><Link to={`/patients/${a.patient_id}`}><b>{d.pts[a.patient_id]?.full_name}</b></Link>
                  <div className="faint">{d.pts[a.patient_id]?.mr_number}{a.kind === 'follow_up' ? ' · follow-up' : ''}</div></td>
                <td><ApptBadge s={a.status} /></td>
                <td className="right">
                  {a.visit_id && isAdmin && <Link className="btn small" to={`/visits/${a.visit_id}`}>Open visit</Link>}
                  {!a.visit_id && ['scheduled', 'confirmed'].includes(a.status) &&
                    <button className="btn small" onClick={() => run(() => updateRow('appointments', a.id, { status: 'waiting' }), 'Marked as arrived')}>Arrived</button>}
                  {!a.visit_id && isAdmin && a.status !== 'completed' && <button className="btn small primary" onClick={() => start(a)}>Start visit</button>}
                </td>
              </tr>
            ))}
            {isAdmin && d.walkIns.map((v) => (
              <tr key={v.id}>
                <td>Walk-in</td>
                <td><Link to={`/patients/${v.patient_id}`}><b>{d.pts[v.patient_id]?.full_name}</b></Link><div className="faint">{d.pts[v.patient_id]?.mr_number}</div></td>
                <td><span className={`badge ${v.status === 'open' ? 'violet' : 'green'}`}>{v.status === 'open' ? 'In consultation' : 'Completed'}</span></td>
                <td className="right"><Link className="btn small" to={`/visits/${v.id}`}>Open visit</Link></td>
              </tr>
            ))}
            {!queue.length && !(isAdmin && d.walkIns.length) && <tr><td className="empty">Nobody in the queue yet. Find the patient and use “Add to today's queue”, or book an appointment.</td></tr>}
          </tbody></table>
        </div>
        <div className="panel">
          <div className="panel-head"><h2>Follow-ups to remind</h2><span className="faint">next 7 days</span></div>
          <table className="t"><tbody>
            {d.upcoming.map((a) => (
              <tr key={a.id}>
                <td style={{ width: 110 }}>{fmtDate(a.appt_date)}</td>
                <td><Link to={`/patients/${a.patient_id}`}><b>{d.pts[a.patient_id]?.full_name}</b></Link><div className="faint">{d.pts[a.patient_id]?.phone}</div></td>
                <td className="right"><RemindButton patient={d.pts[a.patient_id]} appt={a} /></td>
              </tr>
            ))}
            {!d.upcoming.length && <tr><td className="empty">No follow-ups in the next 7 days.</td></tr>}
          </tbody></table>
        </div>
      </div>
      {d.missed.length > 0 && (
        <div className="panel">
          <div className="panel-head"><h2>Missed follow-ups</h2><span className="faint">did not come in the last 30 days</span></div>
          <table className="t"><tbody>
            {d.missed.map((a) => (
              <tr key={a.id}>
                <td style={{ width: 110 }}>{fmtDate(a.appt_date)}</td>
                <td><Link to={`/patients/${a.patient_id}`}><b>{d.pts[a.patient_id]?.full_name}</b></Link><div className="faint">{d.pts[a.patient_id]?.phone}</div></td>
                <td className="right"><RemindButton patient={d.pts[a.patient_id]} appt={a} /></td>
              </tr>
            ))}
          </tbody></table>
        </div>
      )}
      {d.unpaid.length > 0 && (
        <div className="panel">
          <div className="panel-head"><h2>Unpaid bills today</h2></div>
          <table className="t"><tbody>
            {d.unpaid.map((i) => (
              <tr key={i.id} className="click" onClick={() => nav(`/invoices/${i.id}`)}>
                <td>{i.invoice_number}</td><td><b>{d.pts[i.patient_id]?.full_name}</b></td><td className="money">{m(i.due)}</td>
              </tr>
            ))}
          </tbody></table>
        </div>
      )}
    </>
  );
}
