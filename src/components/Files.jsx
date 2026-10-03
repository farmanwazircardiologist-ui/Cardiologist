import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db.js';
import { useAuth } from '../lib/auth.jsx';
import { updateRow } from '../lib/repo.js';
import { FILE_CATEGORIES, categoryLabel, uploadPatientFile, fileUrl } from '../lib/files.js';
import { fmtDate, todayISO } from '../lib/format.js';
import { Field, Modal, Empty, useAction, ConfirmButton } from './ui.jsx';

// Reports the patient brought (outside ECG, Echo, labs…). Shown on the
// patient profile and inside a visit.
export function PatientFiles({ patientId, visitId = null, compact = false }) {
  const { isAdmin } = useAuth();
  const run = useAction();
  const [adding, setAdding] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [cat, setCat] = useState('');
  const files = useLiveQuery(() => db().patient_files.where('patient_id').equals(patientId)
    .filter((f) => !f.deleted_at).toArray(), [patientId], []);
  const list = files.filter((f) => !cat || f.category === cat)
    .sort((a, b) => b.file_date.localeCompare(a.file_date) || (b.created_at || '').localeCompare(a.created_at || ''));
  const cats = [...new Set(files.map((f) => f.category))];
  return (
    <div className={compact ? '' : 'panel'}>
      <div className="panel-head">
        {!compact && <h2>Reports & files</h2>}
        {cats.length > 1 && (
          <div className="chips">
            <button type="button" className={`chip ${!cat ? 'on' : ''}`} onClick={() => setCat('')}>All ({files.length})</button>
            {cats.map((c) => <button type="button" key={c} className={`chip ${cat === c ? 'on' : ''}`} onClick={() => setCat(c)}>{categoryLabel(c)}</button>)}
          </div>
        )}
        <div className="grow" />
        <button type="button" className="btn small primary" onClick={() => setAdding(true)}>Upload report</button>
      </div>
      {!list.length && <Empty>No reports yet. Take a photo of the ECG, Echo or lab report the patient brought and upload it here.</Empty>}
      <div className="files">
        {list.map((f) => (
          <div key={f.id} className="file-card">
            <button type="button" className="file-open" onClick={() => setViewing(f)}>
              <span className={`file-kind ${f.mime_type === 'application/pdf' ? 'pdf' : 'img'}`}>{f.mime_type === 'application/pdf' ? 'PDF' : 'Photo'}</span>
              <b>{f.title || categoryLabel(f.category)}</b>
              <span className="faint">{categoryLabel(f.category)} · {fmtDate(f.file_date)}{f.visit_id && f.visit_id === visitId ? ' · this visit' : ''}</span>
            </button>
            {isAdmin && (
              <ConfirmButton label="Remove" className="btn small ghost" title="Remove report"
                message="The report is hidden from this patient's list. It is kept in storage for the record."
                confirmLabel="Remove" onConfirm={() => run(() => updateRow('patient_files', f.id, { deleted_at: new Date().toISOString() }), 'Report removed')} />
            )}
          </div>
        ))}
      </div>
      {adding && <UploadModal patientId={patientId} visitId={visitId} onClose={() => setAdding(false)} />}
      {viewing && <Viewer file={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function UploadModal({ patientId, visitId, onClose }) {
  const run = useAction();
  const [f, setF] = useState({ category: 'ecg', title: '', date: todayISO(), file: null });
  const [busy, setBusy] = useState(false);
  const offline = navigator.onLine === false;
  async function save() {
    setBusy(true);
    const r = await run(() => uploadPatientFile({ file: f.file, patientId, visitId, category: f.category, title: f.title, fileDate: f.date }), 'Report uploaded');
    setBusy(false);
    if (r) onClose();
  }
  return (
    <Modal title="Upload report" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy || !f.file || offline} onClick={save}>{busy ? 'Uploading…' : 'Upload'}</button></>}>
      {offline && <div className="note warn">Uploading needs internet.</div>}
      <Field label="Type of report">
        <div className="chips">
          {FILE_CATEGORIES.map(([k, l]) => <button type="button" key={k} className={`chip ${f.category === k ? 'on' : ''}`} onClick={() => setF({ ...f, category: k })}>{l}</button>)}
        </div>
      </Field>
      <div className="grid g2" style={{ marginTop: 10 }}>
        <Field label="Title" hint="Optional, e.g. Echo - Punjab Institute of Cardiology"><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Report date"><input type="date" max={todayISO()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
      </div>
      <div style={{ marginTop: 10 }}>
        <Field label="Photo or PDF" required hint="On a phone this opens the camera or gallery. Photos are compressed automatically.">
          <input type="file" accept="image/*,application/pdf" onChange={(e) => setF({ ...f, file: e.target.files[0] || null })} />
        </Field>
      </div>
    </Modal>
  );
}

function Viewer({ file, onClose }) {
  const run = useAction();
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let live = true;
    fileUrl(file).then((u) => live && setUrl({ url: u }), (e) => live && setUrl({ error: e.message }));
    return () => { live = false; };
  }, [file]);
  const isPdf = file.mime_type === 'application/pdf';
  return (
    <Modal wide title={`${file.title || categoryLabel(file.category)} - ${fmtDate(file.file_date)}`} onClose={onClose}
      footer={<>{url?.url && <a className="btn" href={url.url} target="_blank" rel="noreferrer">Open full size</a>}
        {url?.url && <button className="btn" onClick={() => run(async () => {
          const blob = await (await fetch(url.url)).blob();
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = file.storage_path.split('/').pop();
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 3000);
        })}>Download</button>}
        <button className="btn primary" onClick={onClose}>Close</button></>}>
      {!url && <p className="muted">Opening…</p>}
      {url?.error && <div className="note warn">{url.error}</div>}
      {url?.url && (isPdf
        ? <iframe title="Report" src={url.url} className="file-frame" />
        : <img src={url.url} alt={file.title || 'Report'} className="file-img" />)}
    </Modal>
  );
}
