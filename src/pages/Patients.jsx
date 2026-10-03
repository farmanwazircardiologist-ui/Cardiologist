import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db.js';
import { useAuth } from '../lib/auth.jsx';
import { searchPatients } from '../lib/actions.js';
import { ageLabel, genderLabel, fmtDate } from '../lib/format.js';
import { Modal } from '../components/ui.jsx';
import { PatientForm } from '../components/patients.jsx';

export default function Patients() {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const { isAdmin } = useAuth();
  const [q, setQ] = useState('');
  const [archived, setArchived] = useState(false);
  const [limit, setLimit] = useState(50);
  const all = useLiveQuery(() => db().patients.toArray(), [], []);
  const list = searchPatients(all, q, { includeArchived: archived })
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  const adding = sp.get('new') === '1';

  return (
    <>
      <div className="page-head">
        <h1>Patients</h1>
        <span className="muted">{all.filter((p) => !p.deleted_at && !p.archived_at).length} active</span>
        <div className="grow" />
        <button className="btn primary" onClick={() => setSp({ new: '1' })}>New patient</button>
      </div>
      <div className="panel">
        <div className="row" style={{ marginBottom: 10 }}>
          <div className="search" style={{ flex: 1, minWidth: 240 }}>
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, MR number or phone" />
          </div>
          <label className="row faint"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Include archived</label>
        </div>
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Patient</th><th>MR number</th><th>Phone</th><th>Age / gender</th><th>Registered</th></tr></thead>
            <tbody>
              {list.slice(0, limit).map((p) => (
                <tr key={p.id} className="click" onClick={() => nav(`/patients/${p.id}`)}>
                  <td><b>{p.full_name}</b>
                    {p.anticoagulant && p.anticoagulant !== 'none' && <span className="badge red" style={{ marginLeft: 6 }}>{p.anticoagulant === 'doac' ? 'DOAC' : p.anticoagulant}</span>}
                    {p.archived_at && <span className="badge" style={{ marginLeft: 6 }}>Archived</span>}</td>
                  <td>{p.mr_number}</td>
                  <td>{p.phone}</td>
                  <td>{ageLabel(p.dob)} {genderLabel(p.gender)}</td>
                  <td className="faint">{fmtDate(p.created_at)}</td>
                </tr>
              ))}
              {!list.length && <tr><td colSpan="5" className="empty">{q ? 'No patient matches this search.' : 'No patients yet. Register the first patient.'}</td></tr>}
            </tbody>
          </table>
        </div>
        {list.length > limit && <button className="btn small" style={{ marginTop: 10 }} onClick={() => setLimit(limit + 100)}>Show more</button>}
      </div>
      {adding && (
        <Modal title="Register patient" wide onClose={() => setSp({})}>
          <PatientForm showHistory={isAdmin} onCancel={() => setSp({})}
            onSaved={(p) => nav(`/patients/${p.id}`, { replace: true })} />
        </Modal>
      )}
    </>
  );
}
