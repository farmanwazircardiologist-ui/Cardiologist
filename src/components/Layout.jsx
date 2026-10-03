import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAuth } from '../lib/auth.jsx';
import { useSettings, useSync } from '../lib/hooks.js';
import { db } from '../lib/db.js';
import { syncNow } from '../lib/sync.js';
import { fmtDateTime, todayISO } from '../lib/format.js';

const SYNC_TEXT = { online: 'Online', synced: 'All changes saved', syncing: 'Syncing…', offline: 'Offline - saving on this device', error: 'Sync problem' };

export function SyncPill() {
  const s = useSync();
  const nav = useNavigate();
  const { isAdmin } = useAuth();
  let text = SYNC_TEXT[s.status] || s.status;
  if (s.status === 'offline' && s.pending) text = `Offline - ${s.pending} change(s) waiting`;
  if (s.status === 'synced' && s.pending) text = `${s.pending} change(s) waiting`;
  return (
    <button className={`sync ${s.status}`} title={s.lastSync ? `Last sync ${fmtDateTime(s.lastSync)}${s.message ? '\n' + s.message : ''}` : s.message}
      onClick={() => (s.status === 'error' ? nav(isAdmin ? '/settings?tab=sync' : '/sync') : syncNow())}>
      <i />{text}
    </button>
  );
}

function s_offline(s) {
  return s.status === 'offline'
    ? <div className="offline-banner no-print">No internet. You can keep working - everything is saved on this device and will sync automatically when the connection returns.</div>
    : null;
}

// Shown to the Admin until the one-time setup is done, so nothing is guessed.
function SetupBanner() {
  const settings = useSettings();
  const info = useLiveQuery(async () => ({
    doctors: await db().doctors.filter((d) => d.active !== false).count(),
    services: await db().clinic_services.filter((x) => x.active !== false && x.price != null).count(),
  }), [], null);
  if (!settings || !info) return null;
  const todo = [
    !settings.clinic_name && 'Enter clinic name, address and phone (Settings → Clinic)',
    !info.doctors && 'Add the doctor with degrees, PMDC number and Urdu name (Settings → Doctors) - printed on every prescription',
    !info.services && 'Enter the consultation and procedure fees (Settings → Services & fees). No prices are pre-filled.',
  ].filter(Boolean);
  if (!todo.length) return null;
  return (
    <div className="setup-banner no-print"><b>Finish setup</b>
      <ul>{todo.map((t) => <li key={t}>{t}</li>)}</ul>
      <NavLink to="/settings">Open Settings</NavLink>
    </div>
  );
}

export default function Layout() {
  const { isAdmin, profile, user, signOut } = useAuth();
  const settings = useSettings();
  const [open, setOpen] = useState(false);
  const sync = useSync();
  // Phone menu: stop the page behind from scrolling while open; Escape closes it.
  useEffect(() => {
    document.body.classList.toggle('menu-open', open);
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); document.body.classList.remove('menu-open'); };
  }, [open]);
  const today = todayISO();
  const waiting = useLiveQuery(() => db().appointments.where('appt_date').equals(today).filter((a) => a.status === 'waiting').count(), [today], 0);

  const links = isAdmin ? [
    ['/', 'Today'], ['/appointments', 'Appointments', waiting], ['/patients', 'Patients'],
    ['/billing', 'Billing'], ['/reports', 'Reports & backup'], ['/settings', 'Settings'],
  ] : [
    ['/', 'Today'], ['/appointments', 'Appointments', waiting], ['/patients', 'Patients'],
    ['/billing', 'Billing'], ['/sync', 'Sync'],
  ];

  return (
    <div className="shell">
      <aside className={`side ${open ? 'open' : ''}`}>
        <div className="brand"><div>{settings?.clinic_name || 'Heart Clinic'}<small>{isAdmin ? 'Doctor / Admin' : 'Reception'}</small></div>
          <button type="button" className="side-close" onClick={() => setOpen(false)} aria-label="Close menu">&times;</button></div>
        <nav className="nav" onClick={() => setOpen(false)}>
          {links.map(([to, label, count]) => (
            <NavLink key={to} to={to} end={to === '/'}>
              {label}{count ? <span className="count">{count}</span> : null}
            </NavLink>
          ))}
        </nav>
        <div className="side-foot">
          <div>{profile?.full_name || user?.email}</div>
          <button onClick={() => signOut()}>Sign out</button>
        </div>
      </aside>
      {open && <button className="side-backdrop no-print" aria-label="Close menu" onClick={() => setOpen(false)} />}
      <div className="main">
        <div className="topbar no-print">
          <button type="button" className="menu-btn" onClick={() => setOpen(true)} aria-label="Open menu" aria-expanded={open}>
            <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><path d="M3 6h16M3 11h16M3 16h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
          <div className="grow" />
          <SyncPill />
        </div>
        {s_offline(sync)}
        <div className="content">{isAdmin && <SetupBanner />}<Outlet /></div>
      </div>
    </div>
  );
}
