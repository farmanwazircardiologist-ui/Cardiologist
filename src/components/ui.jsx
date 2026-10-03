import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { money } from '../lib/format.js';
import { useSettings } from '../lib/hooks.js';
import { togglePhrase, hasPhrase } from '../lib/rx.js';

// ---------- toast ----------
const ToastCtx = createContext(() => {});
export function ToastProvider({ children }) {
  const [t, setT] = useState(null);
  const show = useCallback((msg, bad = false) => {
    setT({ msg, bad });
    clearTimeout(show.timer);
    show.timer = setTimeout(() => setT(null), bad ? 6000 : 2500);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {t && <div className={`toast ${t.bad ? 'bad' : ''}`} role="status">{t.msg}</div>}
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// Runs an async action and reports errors in plain language.
export function useAction() {
  const toast = useToast();
  return useCallback(async (fn, okMsg) => {
    try {
      const r = await fn();
      if (okMsg) toast(okMsg);
      return r;
    } catch (e) {
      toast(e.message || String(e), true);
      return undefined;
    }
  }, [toast]);
}

export function Money({ v }) {
  const s = useSettings();
  return <span className="money">{money(v, s?.currency || 'Rs')}</span>;
}
export function useMoney() {
  const s = useSettings();
  return (v) => money(v, s?.currency || 'Rs');
}

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

// Confirmation / reason prompt
export function ConfirmButton({ label, title, message, confirmLabel = 'Confirm', danger, reason, onConfirm, className = 'btn small', disabled }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button type="button" className={`${className} ${danger ? 'danger' : ''}`} disabled={disabled} onClick={() => setOpen(true)}>{label}</button>
      {open && (
        <Modal title={title || label} onClose={() => setOpen(false)} footer={<>
          <button className="btn" onClick={() => setOpen(false)}>Keep it</button>
          <button className={`btn ${danger ? 'danger' : 'primary'}`} disabled={busy || (reason && !text.trim())}
            onClick={async () => { setBusy(true); const ok = await onConfirm(text); setBusy(false); if (ok !== false) setOpen(false); }}>
            {confirmLabel}
          </button>
        </>}>
          <p className="muted" style={{ marginTop: 0 }}>{message}</p>
          {reason && <label className="f"><span className="req">{reason}</span>
            <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} /></label>}
        </Modal>
      )}
    </>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map(([k, label]) => (
        <button key={k} role="tab" aria-selected={value === k} className={value === k ? 'on' : ''} onClick={() => onChange(k)}>{label}</button>
      ))}
    </div>
  );
}

export const APPT_LABEL = { scheduled: 'Scheduled', confirmed: 'Confirmed', waiting: 'Waiting', in_consultation: 'In consultation', completed: 'Completed', cancelled: 'Cancelled' };
const APPT_COLOR = { scheduled: 'blue', confirmed: 'blue', waiting: 'amber', in_consultation: 'violet', completed: 'green', cancelled: '' };
export const ApptBadge = ({ s }) => <span className={`badge ${APPT_COLOR[s] || ''}`}>{APPT_LABEL[s] || s}</span>;

export function DueBadge({ due, isVoid }) {
  if (isVoid) return <span className="badge">Void</span>;
  if (due > 0) return <span className="badge red">Due</span>;
  return <span className="badge green">Paid</span>;
}

export function Field({ label, required, children, hint }) {
  return (
    <label className="f">
      <span className={required ? 'req' : ''}>{label}</span>
      {children}
      {hint && <span className="faint">{hint}</span>}
    </label>
  );
}

// Text input that saves on blur (for autosaving forms)
export function BlurInput({ value, onSave, as = 'input', ...rest }) {
  const [v, setV] = useState(value ?? '');
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setV(value ?? ''); }, [value]);
  const Tag = as;
  return (
    <Tag {...rest} value={v}
      onFocus={() => { focused.current = true; }}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => { focused.current = false; if ((value ?? '') !== v) onSave(v); }} />
  );
}

// Simple autocomplete: free text allowed, suggestions from a list
export function Autocomplete({ value, onChange, options, placeholder, onPick, autoFocus }) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const q = (value || '').toLowerCase();
  const list = q.length >= 1 ? options.filter((o) => o.label.toLowerCase().includes(q)).slice(0, 12) : [];
  const pick = (o) => { onChange(o.label); onPick?.(o); setOpen(false); };
  return (
    <div className="ac">
      <input value={value || ''} placeholder={placeholder} autoFocus={autoFocus}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setHi(0); }}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!open || !list.length) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, list.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
          if (e.key === 'Enter') { e.preventDefault(); pick(list[hi]); }
        }} />
      {open && list.length > 0 && (
        <div className="ac-list">
          {list.map((o, i) => (
            <button type="button" key={o.key || o.label} className={i === hi ? 'hi' : ''} onMouseDown={(e) => { e.preventDefault(); pick(o); }}>
              {o.label}{o.hint && <span className="faint"> · {o.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Image picker that shrinks and compresses before saving (keeps DB light)
export function ImagePicker({ value, onChange, maxW = 400, maxH = 200, label }) {
  const toast = useToast();
  async function onFile(f) {
    if (!f) return;
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) { toast('Use a PNG, JPG or WebP image.', true); return; }
    const img = new Image();
    img.src = URL.createObjectURL(f);
    await img.decode();
    const scale = Math.min(1, maxW / img.width, maxH / img.height);
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    let url = c.toDataURL('image/webp', 0.85);
    if (!url.startsWith('data:image/webp')) url = c.toDataURL('image/png');
    if (url.length > 280000) { toast('Image is too large even after compression. Use a simpler image.', true); return; }
    onChange(url);
  }
  return (
    <div className="stack">
      <span className="faint">{label}</span>
      {value && <img src={value} alt="" style={{ maxHeight: 70, maxWidth: 200, border: '1px solid var(--line)', borderRadius: 6, padding: 4, background: '#fff' }} />}
      <div className="row">
        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => onFile(e.target.files[0])} style={{ maxWidth: 260 }} />
        {value && <button type="button" className="btn small" onClick={() => onChange(null)}>Remove</button>}
      </div>
    </div>
  );
}

export function Empty({ children }) { return <div className="empty">{children}</div>; }

// One-tap choices with a free-text box underneath (single value).
export function ChoiceField({ label, value, options, onSave, placeholder }) {
  return (
    <Field label={label}>
      <div className="chips" style={{ marginBottom: 6 }}>
        {options.map((o) => (
          <button type="button" key={o} className={`chip ${value === o ? 'on' : ''}`}
            onClick={() => onSave(value === o ? '' : o)}>{o}</button>
        ))}
      </div>
      <BlurInput value={value} onSave={onSave} placeholder={placeholder || 'or type'} />
    </Field>
  );
}

// Several phrases kept in one comma separated text ("LVH, ST depression").
export function PhraseField({ label, value, options, onSave, rows = 2 }) {
  return (
    <Field label={label}>
      <div className="chips" style={{ marginBottom: 6 }}>
        {options.map((o) => (
          <button type="button" key={o} className={`chip ${hasPhrase(value, o) ? 'on' : ''}`}
            onClick={() => onSave(togglePhrase(value, o))}>{o}</button>
        ))}
      </div>
      <BlurInput as="textarea" rows={rows} value={value} onSave={onSave} />
    </Field>
  );
}

// Tick-list stored as an array of keys.
export function KeyChips({ list, value = [], onChange }) {
  const set = new Set(value || []);
  return (
    <div className="chips">
      {list.map(([k, label]) => (
        <button type="button" key={k} className={`chip ${set.has(k) ? 'on' : ''}`}
          onClick={() => onChange(set.has(k) ? [...set].filter((x) => x !== k) : [...set, k])}>{label}</button>
      ))}
    </div>
  );
}
