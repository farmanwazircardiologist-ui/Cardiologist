import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db.js';
import { supabase } from '../lib/supabase.js';
import { insertRow, updateRow, clean } from '../lib/repo.js';
import { listFailed, retryFailed, discardLocal, syncNow } from '../lib/sync.js';
import { useAuth } from '../lib/auth.jsx';
import { useAllDoctors, useSettings } from '../lib/hooks.js';
import { fmtDate, fmtDateTime } from '../lib/format.js';
import { FORMS, PATTERNS, TIMINGS, DURATIONS } from '../lib/rx.js';
import { Tabs, Field, Modal, ImagePicker, useAction, Money, Empty, ConfirmButton } from '../components/ui.jsx';

const TABS = [['clinic', 'Clinic & printing'], ['doctors', 'Doctors'], ['services', 'Services & fees'],
  ['templates', 'Rx templates'], ['medicines', 'Medicines'], ['users', 'Users'], ['retention', 'Data retention'], ['sync', 'Sync'], ['audit', 'Audit log']];

export default function Settings() {
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') || 'clinic';
  return (
    <>
      <div className="page-head"><h1>Settings</h1></div>
      <Tabs tabs={TABS} value={tab} onChange={(t) => setSp({ tab: t })} />
      {tab === 'clinic' && <ClinicSettings />}
      {tab === 'doctors' && <Doctors />}
      {tab === 'templates' && <Templates />}
      {tab === 'services' && <Services />}
      {tab === 'medicines' && <Medicines />}
      {tab === 'users' && <Users />}
      {tab === 'retention' && <Retention />}
      {tab === 'sync' && <><SyncIssues /><ServerConflicts /></>}
      {tab === 'audit' && <Audit />}
    </>
  );
}

// Saves on this device first (works offline), then, if online, sends it to the
// server and reports a refusal instead of showing a false "saved".
async function confirmSynced(table, id) {
  if (!navigator.onLine) return;
  await syncNow();
  const row = await db()[table].get(id);
  if (row && row._dirty && row._error) {
    const hint = /not allowed|denied/i.test(row._error) ? ' This account is not an active Admin. Check Settings > Users, or ask the person who set up the database.' : '';
    throw new Error(`Saved on this device but NOT on the server: ${row._error}${hint}`);
  }
}

// ---------------- clinic ----------------
function ClinicSettings() {
  const s = useSettings();
  const run = useAction();
  const [f, setF] = useState(null);
  useEffect(() => { if (s && !f) setF(clean(s)); }, [s, f]);
  if (!f) return <div className="panel"><Empty>Loading settings… (first sync must finish once, online)</Empty></div>;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  return (
    <div className="panel stack">
      <div className="grid g2">
        <Field label="Clinic name" required><input value={f.clinic_name || ''} onChange={set('clinic_name')} /></Field>
        <Field label="Address"><input value={f.address || ''} onChange={set('address')} /></Field>
        <Field label="Phone"><input value={f.phone || ''} onChange={set('phone')} /></Field>
        <Field label="WhatsApp"><input value={f.whatsapp || ''} onChange={set('whatsapp')} /></Field>
        <Field label="Email"><input value={f.email || ''} onChange={set('email')} /></Field>
        <Field label="Working hours"><input value={f.working_hours || ''} onChange={set('working_hours')} placeholder="Mon–Sat 5–9 pm" /></Field>
        <div className="grid g2">
          <Field label="Currency label"><input value={f.currency || ''} onChange={set('currency')} /></Field>
          <Field label="Phone country code" hint="Used for WhatsApp links"><input value={f.phone_country_code || ''} onChange={set('phone_country_code')} /></Field>
        </div>
      </div>
      <ImagePicker label="Logo (compressed automatically)" value={f.logo} onChange={(v) => setF({ ...f, logo: v })} />
      <div className="grid g2">
        <Field label="Prescription header note"><textarea value={f.rx_header_note || ''} onChange={set('rx_header_note')} /></Field>
        <Field label="Prescription footer note"><textarea value={f.rx_footer_note || ''} onChange={set('rx_footer_note')} /></Field>
        <Field label="Invoice / receipt footer note"><textarea value={f.invoice_footer_note || ''} onChange={set('invoice_footer_note')} /></Field>
      </div>
      <h3 style={{ margin: '6px 0 0' }}>Prescription printing</h3>
      <div className="grid g3">
        <Field label="Paper size">
          <div className="chips">{['A4', 'A5'].map((k) => <button type="button" key={k} className={`chip ${f.rx_paper === k ? 'on' : ''}`} onClick={() => setF({ ...f, rx_paper: k })}>{k}</button>)}</div>
        </Field>
        <Field label="Medicine instructions in">
          <div className="chips">{[['both', 'English + Urdu'], ['en', 'English'], ['ur', 'Urdu']].map(([k, l]) => <button type="button" key={k} className={`chip ${f.rx_language === k ? 'on' : ''}`} onClick={() => setF({ ...f, rx_language: k })}>{l}</button>)}</div>
        </Field>
        <Field label="When I press Print" hint="PDF and WhatsApp always include the full letterhead.">
          <div className="chips">{[['full', 'Print full letterhead'], ['pad', 'Print on my printed pad']].map(([k, l]) => <button type="button" key={k} className={`chip ${f.rx_print_mode === k ? 'on' : ''}`} onClick={() => setF({ ...f, rx_print_mode: k })}>{l}</button>)}</div>
        </Field>
      </div>
      {f.rx_print_mode === 'pad' && (
        <div className="grid g2">
          <Field label="Space for the printed header (mm)" hint="Measure the pad's letterhead height"><input type="number" min="0" max="150" value={f.rx_pad_top_mm ?? 45} onChange={set('rx_pad_top_mm')} /></Field>
          <Field label="Space for the printed footer (mm)"><input type="number" min="0" max="100" value={f.rx_pad_bottom_mm ?? 20} onChange={set('rx_pad_bottom_mm')} /></Field>
        </div>
      )}
      <h3 style={{ margin: '6px 0 0' }}>Print size and margins</h3>
      <div className="note">Set these once for your printer and paper. Press <b>Test print</b> to try them on a sample prescription, then adjust until it looks right.</div>
      <div className="grid g4">
        <Field label="Text size (%)" hint="100 = normal. Raise it if the print looks small.">
          <input type="number" min="70" max="150" step="5" value={f.print_font_pct ?? 100} onChange={set('print_font_pct')} />
        </Field>
        <Field label="Top margin (mm)"><input type="number" min="0" max="40" value={f.print_margin_top_mm ?? ''} placeholder={f.rx_paper === 'A5' ? '8' : '11'} onChange={set('print_margin_top_mm')} /></Field>
        <Field label="Side margins (mm)"><input type="number" min="0" max="40" value={f.print_margin_side_mm ?? ''} placeholder={f.rx_paper === 'A5' ? '9' : '13'} onChange={set('print_margin_side_mm')} /></Field>
        <Field label="Bottom margin (mm)"><input type="number" min="0" max="40" value={f.print_margin_bottom_mm ?? ''} placeholder={f.rx_paper === 'A5' ? '7' : '9'} onChange={set('print_margin_bottom_mm')} /></Field>
      </div>
      <div className="row">
        <button type="button" className="btn" onClick={() => window.open('/print/test', '_blank')}>Test print (sample prescription)</button>
        <button type="button" className="btn ghost" onClick={() => setF({ ...f, print_font_pct: 100, print_margin_top_mm: null, print_margin_side_mm: null, print_margin_bottom_mm: null })}>Reset size and margins</button>
        <span className="faint">Save first, then test. In the print window choose "Margins: None" and "Scale: 100%".</span>
      </div>
      <FollowupDaysField value={f.followup_days} onChange={(v) => setF({ ...f, followup_days: v })} />
      <div className="row"><div className="spacer" />
        <button className="btn primary" onClick={() => {
          if (!f.clinic_name?.trim()) { run(async () => { throw new Error('Enter the clinic name.'); }); return; }
          if (!/^[0-9]{1,4}$/.test(f.phone_country_code || '')) { run(async () => { throw new Error('Country code must be 1–4 digits, e.g. 92.'); }); return; }
          const { id, created_at, ...rest } = f;
          rest.rx_pad_top_mm = Math.min(150, Math.max(0, Number(rest.rx_pad_top_mm) || 0));
          rest.rx_pad_bottom_mm = Math.min(100, Math.max(0, Number(rest.rx_pad_bottom_mm) || 0));
          rest.print_font_pct = Math.min(150, Math.max(70, Number(rest.print_font_pct) || 100));
          for (const k of ['print_margin_top_mm', 'print_margin_side_mm', 'print_margin_bottom_mm']) {
            rest[k] = rest[k] === null || rest[k] === '' || rest[k] === undefined ? null : Math.min(40, Math.max(0, Number(rest[k]) || 0));
          }
          run(async () => { const r = await updateRow('clinic_settings', 1, { ...rest, setup_completed: true }); await confirmSynced('clinic_settings', 1); return r; }, 'Clinic settings saved');
        }}>Save clinic settings</button>
      </div>
    </div>
  );
}

// Quick-pick day counts on a visit's Follow-up section. Doctor sets their
// own commonly-used values here instead of them being fixed in the code.
function FollowupDaysField({ value, onChange }) {
  const [add, setAdd] = useState('');
  const days = value?.length ? value : [7, 15, 30, 90];
  const addDay = () => {
    const n = Number(add);
    if (Number.isInteger(n) && n > 0 && n <= 365 && !days.includes(n)) onChange([...days, n].sort((a, b) => a - b));
    setAdd('');
  };
  return (
    <Field label="Follow-up day options" hint="Shown as quick buttons when booking a follow-up from a visit.">
      <div className="chips" style={{ marginBottom: 6 }}>
        {days.map((n) => (
          <button type="button" key={n} className="chip on" onClick={() => onChange(days.filter((x) => x !== n))} title="Click to remove">{n} days ×</button>
        ))}
      </div>
      <div className="row" style={{ flexWrap: 'nowrap', maxWidth: 220 }}>
        <input type="number" min="1" max="365" placeholder="e.g. 10" value={add}
          onChange={(e) => setAdd(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addDay())} />
        <button type="button" className="btn small" onClick={addDay}>Add</button>
      </div>
    </Field>
  );
}

// ---------------- doctors ----------------
function Doctors() {
  const docs = useAllDoctors();
  const [edit, setEdit] = useState(null);
  return (
    <div className="panel">
      <div className="panel-head"><h2>Doctors</h2><div className="grow" /><button className="btn primary" onClick={() => setEdit({ active: true })}>Add doctor</button></div>
      <table className="t"><tbody>
        {docs.map((d) => (
          <tr key={d.id} className="click" onClick={() => setEdit(clean(d))}>
            <td><b>{d.full_name}</b><div className="faint">{d.qualification}</div></td><td>{d.designation}</td><td>{d.specialty}</td>
            <td className="right">{d.signature ? <span className="badge green">Signature</span> : <span className="badge">No signature</span>} {!d.active && <span className="badge">Inactive</span>}</td>
          </tr>
        ))}
      </tbody></table>
      {!docs.length && <Empty>Add at least one doctor before starting visits.</Empty>}
      {edit && <DoctorModal d={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function DoctorModal({ d, onClose }) {
  const run = useAction();
  const [f, setF] = useState(d);
  const idRef = useRef(d.id);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  return (
    <Modal wide title={d.id ? 'Edit doctor' : 'Add doctor'} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" onClick={async () => {
        if (!f.full_name?.trim()) return run(async () => { throw new Error('Enter the doctor name.'); });
        const data = { full_name: f.full_name.trim(), qualification: f.qualification || null, designation: f.designation || null, specialty: f.specialty || null,
          name_urdu: f.name_urdu || null, title_urdu: f.title_urdu || null, registration_no: f.registration_no || null,
          phone: f.phone || null, whatsapp: f.whatsapp || null, email: f.email || null, signature: f.signature || null, active: f.active !== false };
        const saved = await run(async () => {
          const r = idRef.current ? await updateRow('doctors', idRef.current, data) : await insertRow('doctors', data);
          idRef.current = r.id; // a retry after a server refusal updates this record, not a duplicate
          await confirmSynced('doctors', r.id);
          return r;
        }, 'Doctor saved');
        if (saved) onClose();
      }}>Save doctor</button></>}>
      <div className="grid g2">
        <Field label="Full name" required><input value={f.full_name || ''} onChange={set('full_name')} placeholder="Dr. …" /></Field>
        <Field label="Name in Urdu" hint="Printed on the right of the letterhead"><input dir="rtl" className="urdu" value={f.name_urdu || ''} onChange={set('name_urdu')} placeholder="ڈاکٹر …" /></Field>
        <Field label="Qualifications"><input value={f.qualification || ''} onChange={set('qualification')} placeholder="MBBS, FCPS (Cardiology)" /></Field>
        <Field label="Title in Urdu"><input dir="rtl" className="urdu" value={f.title_urdu || ''} onChange={set('title_urdu')} placeholder="ماہر امراض قلب" /></Field>
        <Field label="Specialty"><input value={f.specialty || ''} onChange={set('specialty')} placeholder="Consultant Cardiologist" /></Field>
        <Field label="Designation / hospital"><input value={f.designation || ''} onChange={set('designation')} placeholder="Assistant Professor of Cardiology, … Hospital" /></Field>
        <Field label="PMDC registration no."><input value={f.registration_no || ''} onChange={set('registration_no')} /></Field>
        <Field label="Phone"><input value={f.phone || ''} onChange={set('phone')} /></Field>
        <Field label="WhatsApp"><input value={f.whatsapp || ''} onChange={set('whatsapp')} /></Field>
        <Field label="Email"><input value={f.email || ''} onChange={set('email')} /></Field>
        <label className="row"><input type="checkbox" checked={f.active !== false} onChange={set('active')} /> Active</label>
      </div>
      <div style={{ marginTop: 12 }}><ImagePicker label="Signature (optional, printed on prescriptions)" maxW={360} maxH={120} value={f.signature} onChange={(v) => setF({ ...f, signature: v })} /></div>
    </Modal>
  );
}

// ---------------- services ----------------
function Services() {
  const run = useAction();
  const list = useLiveQuery(() => db().clinic_services.toArray(), [], []);
  const [name, setName] = useState('');
  return (
    <div className="panel">
      <div className="panel-head"><h2>Clinic services and fees</h2></div>
      <table className="t">
        <thead><tr><th>Service</th><th className="money">Price</th><th>Ticked by default on a visit bill</th><th>Active</th></tr></thead>
        <tbody>
          {list.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)).map((s) => (
            <tr key={s.id}>
              <td>{s.name}</td>
              <td className="money"><ServicePrice s={s} /></td>
              <td><input type="checkbox" checked={s.auto_add} onChange={(e) => run(() => updateRow('clinic_services', s.id, { auto_add: e.target.checked }))} /></td>
              <td><input type="checkbox" checked={s.active} onChange={(e) => run(() => updateRow('clinic_services', s.id, { active: e.target.checked }))} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row" style={{ marginTop: 10 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New service, e.g. Stress Echo, Pacemaker check" style={{ maxWidth: 360 }} />
        <button className="btn" disabled={!name.trim()} onClick={() => run(async () => {
          if (list.some((s) => s.name.toLowerCase() === name.trim().toLowerCase())) throw new Error('That service already exists.');
          await insertRow('clinic_services', { name: name.trim(), price: null, auto_add: false, active: true, sort_order: list.length + 1 });
          setName('');
        }, 'Service added')}>Add service</button>
      </div>
    </div>
  );
}
function ServicePrice({ s }) {
  const run = useAction();
  const [v, setV] = useState(s.price ?? '');
  useEffect(() => setV(s.price ?? ''), [s.price]);
  return <input type="number" min="0" value={v} placeholder="Set price" style={{ width: 120, textAlign: 'right' }} onChange={(e) => setV(e.target.value)}
    onBlur={() => { const n = v === '' ? null : Number(v); if (n !== null && (!(n >= 0))) return setV(s.price ?? ''); if (n !== (s.price ?? null)) run(() => updateRow('clinic_services', s.id, { price: n }), 'Price saved'); }} />;
}

// ---------------- medicines ----------------
function Medicines() {
  const run = useAction();
  const list = useLiveQuery(() => db().medicines.toArray(), [], []);
  const [q, setQ] = useState('');
  const [f, setF] = useState({ name: '', form: 'Tab' });
  const shown = list.filter((m) => !q || m.name.toLowerCase().includes(q.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="panel">
      <div className="panel-head"><h2>Medicines</h2><span className="faint">New names typed in prescriptions are added automatically. Defaults fill in when the medicine is picked.</span><div className="grow" />
        <div className="search" style={{ width: 220 }}><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find medicine" /></div></div>
      <div className="row" style={{ marginBottom: 10 }}>
        <select value={f.form} onChange={(e) => setF({ ...f, form: e.target.value })} style={{ maxWidth: 110 }}>{FORMS.map(([k, l]) => <option key={k} value={k}>{l || k}</option>)}</select>
        <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Medicine name and strength" style={{ maxWidth: 320 }} />
        <button className="btn" disabled={!f.name.trim()} onClick={() => run(async () => {
          if (list.some((m) => m.name.toLowerCase() === f.name.trim().toLowerCase())) throw new Error('Already in the list.');
          await insertRow('medicines', { name: f.name.trim(), form: f.form || null, active: true }); setF({ name: '', form: 'Tab' });
        }, 'Medicine added')}>Add</button>
      </div>
      <div className="table-wrap"><table className="t">
        <thead><tr><th>Medicine</th><th>Default dose</th><th>When</th><th>For</th><th /></tr></thead>
        <tbody>
        {shown.slice(0, 300).map((m) => (
          <tr key={m.id} style={m.active === false ? { opacity: .5 } : null}>
            <td>{m.form && <span className="faint">{m.form} </span>}{m.name}</td>
            <td><MedDefault m={m} k="default_pattern" list={PATTERNS} /></td>
            <td><MedDefault m={m} k="default_timing" list={TIMINGS} /></td>
            <td><MedDefault m={m} k="default_duration" list={DURATIONS} /></td>
            <td className="right"><button className="btn small ghost" onClick={() => run(() => updateRow('medicines', m.id, { active: m.active === false }))}>{m.active === false ? 'Show in suggestions' : 'Hide from suggestions'}</button></td>
          </tr>
        ))}
        </tbody></table></div>
    </div>
  );
}

function MedDefault({ m, k, list }) {
  const [v, setV] = useState(m[k] || '');
  useEffect(() => setV(m[k] || ''), [m[k]]); // eslint-disable-line
  const id = 'md-' + k;
  return (
    <>
      <input list={id} value={v} style={{ maxWidth: 130 }} onChange={(e) => setV(e.target.value)}
        onBlur={() => v !== (m[k] || '') && updateRow('medicines', m.id, { [k]: v || null })} />
      <datalist id={id}>{list.map((x) => <option key={x} value={x} />)}</datalist>
    </>
  );
}

// ---------------- prescription templates ----------------
function Templates() {
  const run = useAction();
  const list = useLiveQuery(() => db().rx_templates.toArray(), [], []);
  const [edit, setEdit] = useState(null);
  return (
    <div className="panel">
      <div className="panel-head"><h2>Prescription templates</h2><div className="grow" />
        <button className="btn primary" onClick={() => setEdit({ name: '', diagnosis: '', medicines: [], investigations: [], advice: '', active: true })}>New template</button></div>
      <div className="note" style={{ marginBottom: 10 }}>Starter templates contain common example doses only. Review each one and set your own doses. A template can also be saved straight from a visit with “Save as template”.</div>
      <table className="t"><tbody>
        {list.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)).map((t) => (
          <tr key={t.id} style={t.active === false ? { opacity: .5 } : null}>
            <td><b>{t.name}</b>{t.is_starter && <span className="badge amber" style={{ marginLeft: 6 }}>Starter</span>}
              <div className="faint">{(t.medicines || []).map((m) => `${m.name} ${m.pattern || ''}`).join(' · ')}</div></td>
            <td className="right"><div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
              <button className="btn small" onClick={() => setEdit(clean(t))}>Edit</button>
              <button className="btn small ghost" onClick={() => run(() => updateRow('rx_templates', t.id, { active: t.active === false }))}>{t.active === false ? 'Enable' : 'Disable'}</button>
            </div></td>
          </tr>
        ))}
        {!list.length && <tr><td className="empty">No templates yet.</td></tr>}
      </tbody></table>
      {edit && <TemplateModal t={edit} onClose={() => setEdit(null)} count={list.length} />}
    </div>
  );
}

const medLine = (m) => [m.form, m.name, m.pattern, m.timing, m.duration].map((x) => (x || '').trim()).join(' | ');
function parseMedLine(line) {
  const [form, name, pattern, timing, duration] = line.split('|').map((x) => x.trim());
  return name ? { form: form || 'Tab', name, pattern: pattern || '', timing: timing || '', duration: duration || '' } : null;
}

function TemplateModal({ t, onClose, count }) {
  const run = useAction();
  const [f, setF] = useState({ ...t, medsText: (t.medicines || []).map(medLine).join('\n'), testsText: (t.investigations || []).join(', ') });
  async function save() {
    if (!f.name.trim()) throw new Error('Give the template a name.');
    const medicines = f.medsText.split('\n').map((l) => l.trim()).filter(Boolean).map(parseMedLine).filter(Boolean);
    const data = { name: f.name.trim(), diagnosis: f.diagnosis || null, medicines,
      investigations: f.testsText.split(',').map((x) => x.trim()).filter(Boolean), advice: f.advice || null, active: f.active !== false, is_starter: false };
    if (t.id) await updateRow('rx_templates', t.id, data); else await insertRow('rx_templates', { ...data, sort_order: count + 1 });
    onClose();
  }
  return (
    <Modal wide title={t.id ? `Edit template - ${t.name}` : 'New template'} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" onClick={() => run(save, 'Template saved')}>Save template</button></>}>
      <div className="grid g2">
        <Field label="Name" required><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Diagnosis"><input value={f.diagnosis || ''} onChange={(e) => setF({ ...f, diagnosis: e.target.value })} /></Field>
      </div>
      <div style={{ marginTop: 10 }}>
        <Field label="Medicines - one per line: form | name | dose | when | for" hint="e.g.  Tab | Bisoprolol 2.5 mg | 1+0+0 | | 1 month">
          <textarea rows={6} value={f.medsText} onChange={(e) => setF({ ...f, medsText: e.target.value })} style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13 }} />
        </Field>
      </div>
      <div className="grid g2" style={{ marginTop: 10 }}>
        <Field label="Investigations (comma separated)"><input value={f.testsText} onChange={(e) => setF({ ...f, testsText: e.target.value })} /></Field>
        <Field label="Advice (one per line)"><textarea rows={3} dir="auto" value={f.advice || ''} onChange={(e) => setF({ ...f, advice: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

// ---------------- users ----------------
function Users() {
  const run = useAction();
  const { user, refreshProfile } = useAuth();
  const list = useLiveQuery(() => db().profiles.toArray(), [], []);
  const change = (p, patch) => run(async () => { await updateRow('profiles', p.id, patch); if (p.id === user.id) await refreshProfile(); }, 'User updated');
  return (
    <div className="panel">
      <div className="panel-head"><h2>Users</h2></div>
      <div className="note" style={{ marginBottom: 10 }}>
        To add a user: Supabase dashboard → Authentication → Users → <b>Add user</b> (email + password). The account appears here as an inactive Reception user within a minute; tick Active. Reception can register patients, manage the queue and appointments, take fees and upload reports. Only the doctor sees visits and prescriptions.
      </div>
      <table className="t">
        <thead><tr><th>User</th><th>Role</th><th>Active</th></tr></thead>
        <tbody>
          {list.map((p) => (
            <tr key={p.id}>
              <td><b>{p.full_name}</b><div className="faint">{p.email}</div></td>
              <td><select value={p.role} style={{ width: 150 }} onChange={(e) => change(p, { role: e.target.value })}><option value="admin">Doctor / Admin</option><option value="reception">Reception</option></select></td>
              <td><input type="checkbox" checked={p.active} disabled={p.id === user.id} onChange={(e) => change(p, { active: e.target.checked })} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="faint">The server always keeps at least one active Admin. Password resets are done in the Supabase dashboard.</p>
    </div>
  );
}

// ---------------- retention ----------------
function Retention() {
  const s = useSettings();
  const run = useAction();
  const [list, setList] = useState(null);
  const [sel, setSel] = useState([]);
  const [years, setYears] = useState('');
  useEffect(() => { if (s) setYears(String(s.retention_years)); }, [s?.retention_years]);
  const online = navigator.onLine;
  async function load() {
    const { data, error } = await supabase.rpc('retention_candidates');
    if (error) throw new Error(error.message);
    setList(data || []); setSel([]);
  }
  return (
    <div className="panel stack">
      <h2>Data retention</h2>
      <p className="muted" style={{ margin: 0 }}>Nothing is ever hard-deleted. Patients inactive for longer than the retention period - with no open visit, future appointment or unpaid balance - are <b>archived</b> (hidden from default search, restored automatically if they return). Archived patients can then be <b>anonymized</b>: name, phone, address and free-text notes are removed, while invoices and payments stay intact. When pg_cron is enabled in Supabase, archiving also runs automatically on the 1st of each month.</p>
      <div className="row">
        <Field label="Retention period (years)"><input type="number" min="1" max="50" value={years} onChange={(e) => setYears(e.target.value)} style={{ width: 120 }} /></Field>
        <button className="btn" style={{ alignSelf: 'flex-end' }} onClick={() => run(() => {
          const n = Number(years); if (!(n >= 1 && n <= 50)) throw new Error('Enter 1–50 years.');
          return updateRow('clinic_settings', 1, { retention_years: n });
        }, 'Retention period saved')}>Save</button>
      </div>
      {!online && <div className="note warn">Retention tools need an internet connection.</div>}
      <div className="row">
        <button className="btn" disabled={!online} onClick={() => run(load)}>Show eligible patients</button>
        <ConfirmButton className="btn" label="Archive eligible patients now" disabled={!online} title="Archive patients" confirmLabel="Archive"
          message="Eligible inactive patients will be archived. No data is removed." onConfirm={() => run(async () => {
            const { data, error } = await supabase.rpc('retention_archive'); if (error) throw new Error(error.message);
            await supabase.rpc('retention_housekeeping'); await syncNow(); await load(); return data;
          }, 'Archiving done')} />
      </div>
      {list && (
        <>
          <table className="t">
            <thead><tr><th /><th>Patient</th><th>Last activity</th><th>Status</th></tr></thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.patient_id}>
                  <td><input type="checkbox" disabled={!c.archived} checked={sel.includes(c.patient_id)} onChange={(e) => setSel(e.target.checked ? [...sel, c.patient_id] : sel.filter((x) => x !== c.patient_id))} /></td>
                  <td>{c.full_name} <span className="faint">{c.mr_number}</span></td>
                  <td>{fmtDate(c.last_activity)}</td>
                  <td>{c.archived ? <span className="badge">Archived</span> : <span className="badge amber">Eligible for archive</span>}</td>
                </tr>
              ))}
              {!list.length && <tr><td colSpan="4" className="empty">No patients are past the retention period.</td></tr>}
            </tbody>
          </table>
          <ConfirmButton className="btn" danger label={`Anonymize selected (${sel.length})`} disabled={!sel.length} title="Anonymize patients" confirmLabel="Anonymize permanently"
            message="Names, phone numbers, addresses and clinical free-text notes of the selected archived patients will be removed permanently. Financial records stay. This cannot be undone."
            onConfirm={() => run(async () => {
              const { error } = await supabase.rpc('retention_anonymize', { p_patient_ids: sel }); if (error) throw new Error(error.message);
              await syncNow(); await load();
            }, 'Anonymized')} />
        </>
      )}
    </div>
  );
}

// ---------------- sync ----------------
export function SyncIssues() {
  const run = useAction();
  const [list, setList] = useState([]);
  const refresh = () => listFailed().then(setList);
  useEffect(() => { refresh(); const t = setInterval(refresh, 5000); return () => clearInterval(t); }, []);
  return (
    <div className="panel">
      <div className="panel-head"><h2>Changes on this device that did not sync</h2><div className="grow" /><button className="btn small" onClick={() => run(async () => { await syncNow(); await refresh(); }, 'Sync finished')}>Sync now</button></div>
      {!list.length && <Empty>Everything on this device has reached the server, or is waiting for internet.</Empty>}
      <table className="t"><tbody>
        {list.map(({ table, row }) => (
          <tr key={table + row.id}>
            <td><b>{table.replace(/_/g, ' ')}</b><div className="faint">{row.mr_number || row.visit_number || row.invoice_number || row.rx_number || row.full_name || row.name || row.id}</div></td>
            <td className="error-text">{row._error}</td>
            <td className="right"><div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn small" onClick={() => run(async () => { await retryFailed(table, row.id); await refresh(); })}>Try again</button>
              <ConfirmButton label="Discard this change" danger title="Discard local change" confirmLabel="Discard"
                message={row._base ? 'This device goes back to the last version saved on the server.' : 'This record was never saved on the server and will be removed from this device. Records that depend on it will also fail to sync.'}
                onConfirm={() => run(async () => { await discardLocal(table, row.id); await refresh(); }, 'Discarded')} />
            </div></td>
          </tr>
        ))}
      </tbody></table>
    </div>
  );
}

function ServerConflicts() {
  const run = useAction();
  const [rows, setRows] = useState(null);
  async function load() {
    const { data, error } = await supabase.from('sync_conflicts').select('*').is('resolved_at', null).order('created_at', { ascending: false }).limit(100);
    if (error) throw new Error(error.message);
    setRows(data);
  }
  useEffect(() => { if (navigator.onLine) run(load); }, []); // eslint-disable-line
  async function resolve(c, how) {
    if (how === 'mine' && c.local_data && c.record_id) {
      const cur = await db()[c.table_name]?.get(c.record_id);
      if (!cur) throw new Error('Record is not on this device.');
      const { id, created_at, updated_at, row_version, created_by, updated_by, ...patch } = c.local_data;
      await updateRow(c.table_name, c.record_id, patch);
    }
    const { data: s } = await supabase.auth.getSession();
    const { error } = await supabase.from('sync_conflicts').update({ resolved_at: new Date().toISOString(), resolved_by: s.session?.user?.id, resolution: how }).eq('id', c.id);
    if (error) throw new Error(error.message);
    await load();
  }
  return (
    <div className="panel">
      <div className="panel-head"><h2>Conflicts reported by all devices</h2><div className="grow" /><button className="btn small" onClick={() => run(load)}>Refresh</button></div>
      {rows === null && <p className="muted">Connect to the internet to see conflicts.</p>}
      {rows && !rows.length && <Empty>No open conflicts.</Empty>}
      {rows && rows.map((c) => (
        <div key={c.id} className="note warn" style={{ marginBottom: 8 }}>
          <div className="row"><b>{c.table_name}</b><span className="faint">{fmtDateTime(c.created_at)} · device {c.device_code}</span><div className="spacer" />
            {c.server_data && c.local_data && <button className="btn small" onClick={() => run(() => resolve(c, 'mine'), 'Applied the other version')}>Apply the saved version</button>}
            <button className="btn small" onClick={() => run(() => resolve(c, 'kept'), 'Marked as resolved')}>Keep current</button></div>
          <div>{c.error}</div>
          {c.server_data && c.local_data && <details><summary>Compare</summary>
            <table className="t"><thead><tr><th>Field</th><th>Saved version</th><th>Current (server)</th></tr></thead><tbody>
              {Object.keys(c.local_data).filter((k) => JSON.stringify(c.local_data[k]) !== JSON.stringify(c.server_data[k]) && !['updated_at', 'row_version', 'updated_by'].includes(k)).map((k) => (
                <tr key={k}><td>{k}</td><td>{JSON.stringify(c.local_data[k])}</td><td>{JSON.stringify(c.server_data[k])}</td></tr>
              ))}
            </tbody></table></details>}
        </div>
      ))}
    </div>
  );
}

function Audit() {
  const run = useAction();
  const [rows, setRows] = useState(null);
  const [table, setTable] = useState('');
  async function load() {
    let q = supabase.from('audit_log').select('*').order('at', { ascending: false }).limit(200);
    if (table) q = q.eq('table_name', table);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    setRows(data);
  }
  useEffect(() => { if (navigator.onLine) run(load); }, [table]); // eslint-disable-line
  return (
    <div className="panel">
      <div className="panel-head"><h2>Audit log</h2><div className="grow" />
        <select value={table} onChange={(e) => setTable(e.target.value)} style={{ width: 220 }}>
          <option value="">All records</option>
          {['payments', 'invoices', 'invoice_items', 'prescriptions', 'letters', 'cardiac_reports', 'implants', 'visits', 'patient_files', 'patients', 'rx_templates', 'clinic_services', 'clinic_settings', 'profiles', 'doctors'].map((t) => <option key={t} value={t}>{t}</option>)}
        </select></div>
      {rows === null && <p className="muted">Connect to the internet to view the audit log.</p>}
      {rows && <div className="table-wrap"><table className="t"><tbody>
        {rows.map((r) => (
          <tr key={r.id}><td className="faint" style={{ width: 130 }}>{fmtDateTime(r.at)}</td><td>{r.table_name}</td><td>{r.action}</td>
            <td style={{ fontSize: 12, wordBreak: 'break-word' }}>{r.action === 'update' ? Object.entries(r.changes || {}).map(([k, v]) => `${k}: ${JSON.stringify(v.old)} → ${JSON.stringify(v.new)}`).join('; ') : ''}</td></tr>
        ))}
      </tbody></table></div>}
    </div>
  );
}
