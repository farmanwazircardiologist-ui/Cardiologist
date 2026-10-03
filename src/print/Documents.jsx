import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db.js';
import { useSettings } from '../lib/hooks.js';
import { ageLabel, fmtDate, fmtDateTime, genderLabel, money, waNumber } from '../lib/format.js';
import { invoiceTotals, methodLabel } from '../lib/billing.js';
import { englishLine, urduLine, medTitle, riskShort, historyShort, letterTitle, splitAdvice } from '../lib/rx.js';

// Every document here is built from database rows at the moment it is opened.
// Nothing is uploaded or stored: Print uses the browser, PDF is made in memory.

const NOT_FOUND = Symbol('not-found');

function useDoc(loader, deps) {
  return useLiveQuery(async () => (await loader()) ?? NOT_FOUND, deps);
}

// html2canvas does not lay out right-to-left Urdu reliably, so for the PDF
// every Urdu line is drawn by the browser's own text engine onto a canvas
// first, and the picture is used in its place while the PDF is made.
async function urduToImages(root) {
  const swaps = [];
  try { await document.fonts?.ready; } catch { /* ignore */ }
  for (const el of root.querySelectorAll('.urdu')) {
    const text = el.textContent.trim();
    const rect = el.getBoundingClientRect();
    if (!text || !rect.width) continue;
    const cs = getComputedStyle(el);
    const scale = 3;
    const size = parseFloat(cs.fontSize) || 14;
    const lineH = size * 2;
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    ctx.font = `${cs.fontWeight} ${size}px ${cs.fontFamily}`;
    // wrap words into lines that fit the element width
    const words = text.split(/\s+/);
    const lines = [];
    let cur = '';
    for (const w of words) {
      const t = cur ? `${cur} ${w}` : w;
      if (cur && ctx.measureText(t).width > rect.width) { lines.push(cur); cur = w; } else cur = t;
    }
    if (cur) lines.push(cur);
    c.width = Math.ceil(rect.width * scale);
    c.height = Math.ceil(lines.length * lineH * scale);
    ctx.scale(scale, scale);
    ctx.font = `${cs.fontWeight} ${size}px ${cs.fontFamily}`;
    ctx.fillStyle = cs.color;
    ctx.direction = 'rtl';
    ctx.textBaseline = 'middle';
    const alignRight = cs.textAlign !== 'left' && cs.textAlign !== 'center';
    ctx.textAlign = cs.textAlign === 'center' ? 'center' : alignRight ? 'right' : 'left';
    const x = cs.textAlign === 'center' ? rect.width / 2 : alignRight ? rect.width : 0;
    lines.forEach((l, i) => ctx.fillText(l, x, lineH * i + lineH / 2));
    const img = document.createElement('img');
    img.src = c.toDataURL('image/png');
    img.className = 'urdu-pdf';
    img.style.width = `${rect.width}px`;
    img.style.height = `${lines.length * lineH}px`;
    const saved = el.innerHTML;
    el.innerHTML = '';
    el.appendChild(img);
    swaps.push(() => { el.innerHTML = saved; });
  }
  return () => swaps.forEach((f) => f());
}

async function makePdf(el, filename, format = 'a4') {
  const { default: html2pdf } = await import('html2pdf.js');
  el.classList.add('pdf-mode');
  const restore = await urduToImages(el);
  try {
    return await html2pdf().set({
      margin: 0,
      filename,
      image: { type: 'jpeg', quality: 0.95 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
      jsPDF: { unit: 'mm', format, orientation: 'portrait' },
      pagebreak: { mode: ['css', 'legacy'], avoid: ['.rx-med', '.rx-fu', '.sig', 'tr'] },
    }).from(el).outputPdf('blob');
  } finally {
    restore();
    el.classList.remove('pdf-mode');
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function PrintShell({ title, filename, phone, shareText, children, paper = 'A4', pad = null }) {
  const nav = useNavigate();
  const settings = useSettings();
  const ref = useRef(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const a5 = paper === 'A5';

  // Page size for printing. On a printed pad the blank letterhead/footer
  // areas are page margins, so they are kept free on EVERY printed page.
  const padTop = pad?.top, padBottom = pad?.bottom;
  useEffect(() => {
    const st = document.createElement('style');
    const margin = pad ? `${padTop}mm 0 ${padBottom}mm 0` : '0';
    st.textContent = `@media print { @page { size: ${a5 ? 'A5' : 'A4'}; margin: ${margin}; } }`;
    document.head.appendChild(st);
    return () => st.remove();
  }, [a5, !!pad, padTop, padBottom]); // eslint-disable-line

  async function pdf() {
    setBusy('pdf'); setMsg('');
    try { downloadBlob(await makePdf(ref.current, filename, a5 ? 'a5' : 'a4'), filename); }
    catch (e) { setMsg('Could not create the PDF: ' + e.message); }
    finally { setBusy(''); }
  }

  async function whatsapp() {
    setBusy('wa'); setMsg('');
    try {
      const blob = await makePdf(ref.current, filename, a5 ? 'a5' : 'a4');
      const file = new File([blob], filename, { type: 'application/pdf' });
      // Phones: the share sheet sends the PDF itself (choose WhatsApp).
      if (navigator.canShare?.({ files: [file] })) {
        try { await navigator.share({ files: [file], title, text: shareText }); return; }
        catch (e) { if (e.name === 'AbortError') return; }
      }
      // Computers: WhatsApp links cannot carry attachments, so the PDF is
      // downloaded and the chat opens ready for the user to attach it.
      downloadBlob(blob, filename);
      const n = waNumber(phone, settings?.phone_country_code || '92');
      const text = encodeURIComponent(`${shareText}\n(PDF attached: ${filename})`);
      window.open(n ? `https://wa.me/${n}?text=${text}` : `https://wa.me/?text=${text}`, '_blank', 'noopener');
      setMsg('PDF downloaded. Attach it in the WhatsApp chat that opened.');
    } catch (e) { setMsg('Could not share: ' + e.message); }
    finally { setBusy(''); }
  }

  return (
    <div className="print-page">
      <div className="print-bar no-print">
        <button className="btn" onClick={() => nav(-1)}>← Back</button>
        <div className="grow" />
        {pad && <span className="faint">Print uses your printed pad (letterhead left blank)</span>}
        <button className="btn primary" onClick={() => window.print()} disabled={!!busy}>Print</button>
        <button className="btn" onClick={pdf} disabled={!!busy}>{busy === 'pdf' ? 'Making PDF…' : 'Save PDF'}</button>
        <button className="btn" onClick={whatsapp} disabled={!!busy}>{busy === 'wa' ? 'Preparing…' : 'WhatsApp'}</button>
        {msg && <div className="note" style={{ width: '100%' }}>{msg}</div>}
      </div>
      <div className="paper-wrap">
        <div className={`paper ${a5 ? 'a5' : ''} ${pad ? 'print-pad' : ''}`} ref={ref}>{children}</div>
      </div>
    </div>
  );
}

function Waiting({ value, what }) {
  if (value === undefined) return <div className="content muted">Loading…</div>;
  return (
    <div className="content">
      <div className="panel"><h2>{what} not found on this device</h2>
        <p className="muted">It may not have synced yet. Connect to the internet and wait a moment, or go back.</p></div>
    </div>
  );
}

// Plain header used on invoices and receipts.
function Header({ s, doctor }) {
  const contact = [s?.phone && `Ph: ${s.phone}`, s?.whatsapp && `WhatsApp: ${s.whatsapp}`, s?.email].filter(Boolean).join('  ·  ');
  return (
    <div className="doc-head">
      {s?.logo && <img src={s.logo} alt="" />}
      <div className="clinic">
        <h1>{s?.clinic_name || 'Clinic'}</h1>
        {s?.address && <div>{s.address}</div>}
        {contact && <div>{contact}</div>}
        {s?.working_hours && <div>{s.working_hours}</div>}
      </div>
      {doctor && (
        <div className="dr">
          <b>{doctor.full_name}</b>
          {doctor.qualification && <div>{doctor.qualification}</div>}
          {doctor.specialty && <div>{doctor.specialty}</div>}
        </div>
      )}
    </div>
  );
}

function PatientRow({ p, at, extra = [] }) {
  const cells = [
    ['Patient', p?.full_name], ['MR No.', p?.mr_number],
    ['Age / Sex', [ageLabel(p?.dob, at ? new Date(at) : new Date()), genderLabel(p?.gender)].filter(Boolean).join(' / ') || '-'],
    ...extra,
  ];
  return <div className="doc-pt">{cells.map(([k, v]) => <div key={k}><span>{k}: </span><b>{v || '-'}</b></div>)}</div>;
}

/* ---------------------------------------------------- Doctor's letterhead */
// A heartbeat trace under the letterhead - the one decorative element.
function EcgRule() {
  return (
    <svg className="ecg-rule lh" viewBox="0 0 600 24" preserveAspectRatio="none" aria-hidden="true">
      <polyline points="0,14 250,14 262,14 268,9 274,14 282,14 288,17 294,1 300,23 306,14 316,14 326,10 338,14 600,14" />
    </svg>
  );
}

function Letterhead({ s, doctor }) {
  return (
    <>
      <header className="lh lh-top">
        <div className="lh-en">
          <h1>{doctor?.full_name || s?.clinic_name || 'Doctor'}</h1>
          {doctor?.qualification && <div className="lh-q">{doctor.qualification}</div>}
          {doctor?.specialty && <div>{doctor.specialty}</div>}
          {doctor?.designation && <div>{doctor.designation}</div>}
          {doctor?.registration_no && <div className="lh-reg">PMDC Reg. {doctor.registration_no}</div>}
        </div>
        <div className="lh-mid">{s?.logo && <img className="lh-logo" src={s.logo} alt="" />}</div>
        <div className="lh-ur">
          {doctor?.name_urdu && <div className="urdu lh-ur-name" dir="rtl" lang="ur">{doctor.name_urdu}</div>}
          {doctor?.title_urdu && <div className="urdu" dir="rtl" lang="ur">{doctor.title_urdu}</div>}
        </div>
      </header>
      <EcgRule />
    </>
  );
}

function LetterFoot({ s, number }) {
  const contact = [s?.phone && `Ph: ${s.phone}`, s?.whatsapp && `WhatsApp: ${s.whatsapp}`, s?.email].filter(Boolean).join('   ');
  return (
    <footer className="lh-foot">
      <div className="lh lh-clinic">
        <b>{s?.clinic_name}</b>{s?.address && <span> · {s.address}</span>}
        {(contact || s?.working_hours) && <div>{[contact, s?.working_hours].filter(Boolean).join('   ·   ')}</div>}
      </div>
      <div className="lh-small"><span>{s?.rx_footer_note || ''}</span><span>{number}</span></div>
    </footer>
  );
}

function Signature({ doctor }) {
  return (
    <div className="sig">
      {doctor?.signature && <img src={doctor.signature} alt="" />}
      <div>{doctor?.full_name}{doctor?.registration_no ? <><br /><small>PMDC {doctor.registration_no}</small></> : null}</div>
    </div>
  );
}

const guardianLine = (p) => (p?.guardian_name ? `${p.gender === 'female' ? 'D/W/o' : 'S/o'} ${p.guardian_name}` : '');
const padOf = (s) => (s.rx_print_mode === 'pad' ? { top: s.rx_pad_top_mm ?? 45, bottom: s.rx_pad_bottom_mm ?? 20 } : null);

/* ------------------------------------------------------------ Prescription */
function examLine(v) {
  return [
    v.rhythm && `Pulse ${v.rhythm.toLowerCase()}`, v.heart_sounds, v.murmur && v.murmur !== 'None' && v.murmur,
    v.jvp && `JVP ${v.jvp.toLowerCase()}`, v.edema && v.edema !== 'None' && `Oedema ${v.edema.replace('Pedal ', '')}`,
    v.chest_exam && `Chest ${v.chest_exam.toLowerCase()}`, v.examination,
  ].filter(Boolean).join(', ');
}

export function PrescriptionDoc() {
  const { id } = useParams();
  const s = useSettings();
  const d = useDoc(async () => {
    const rx = await db().prescriptions.get(id);
    if (!rx) return null;
    const [visit, patient, doctor, fu] = await Promise.all([
      db().visits.get(rx.visit_id), db().patients.get(rx.patient_id), db().doctors.get(rx.doctor_id),
      db().appointments.where('patient_id').equals(rx.patient_id)
        .filter((a) => a.source_visit_id === rx.visit_id && a.status !== 'cancelled' && !a.deleted_at).first(),
    ]);
    return { rx, visit, patient, doctor, followUp: fu?.appt_date || rx.follow_up_date || null };
  }, [id]);
  if (!d || d === NOT_FOUND || !s) return <Waiting value={d === NOT_FOUND ? null : d && s} what="Prescription" />;
  const { rx, visit: v = {}, patient, doctor, followUp } = d;
  const lang = s.rx_language || 'both';
  const date = v.visit_date || rx.created_at;
  const meds = (rx.medicines || []).filter((m) => m.name);
  const vitals = [
    v.bp_systolic && v.bp_diastolic && ['BP', `${v.bp_systolic}/${v.bp_diastolic}`, 'mmHg'],
    v.pulse && ['Pulse', v.pulse, '/min'], v.spo2 && ['SpO₂', v.spo2, '%'],
    v.weight_kg && ['Weight', v.weight_kg, 'kg'], v.bmi && ['BMI', v.bmi, ''],
    v.temperature && ['Temp', v.temperature, '°F'], v.blood_sugar && ['BSR', v.blood_sugar, 'mg/dL'],
    v.inr && ['INR', v.inr, patient?.inr_target ? `(target ${patient.inr_target})` : ''],
  ].filter(Boolean);
  const bg = [...(patient?.risk_factors || []).map(riskShort), ...(patient?.cardiac_history || []).map(historyShort)];
  const exam = examLine(v);
  const diagnosis = v.diagnosis || rx.diagnosis;
  const advice = String(rx.advice || '').split('\n').map((x) => x.trim()).filter(Boolean);

  return (
    <PrintShell title={`Prescription ${rx.rx_number}`} filename={`Prescription-${patient?.full_name?.replace(/\s+/g, '-') || ''}-${rx.rx_number}.pdf`}
      phone={patient?.phone} paper={s.rx_paper || 'A4'} pad={padOf(s)}
      shareText={`Prescription for ${patient?.full_name} (${patient?.mr_number}) - ${doctor?.full_name || s.clinic_name || ''}, ${fmtDate(date)}`}>
      <Letterhead s={s} doctor={doctor} />
      {s.rx_header_note && <div className="lh rx-note">{s.rx_header_note}</div>}
      <div className="rx-pt">
        <div className="rx-pt-name"><span>Name</span><b>{patient?.full_name}</b>{guardianLine(patient) && <small>{guardianLine(patient)}</small>}</div>
        <div><span>Age / Sex</span><b>{[ageLabel(patient?.dob, new Date(date)), genderLabel(patient?.gender)].filter(Boolean).join(' / ') || '-'}</b></div>
        <div><span>MR No.</span><b>{patient?.mr_number}</b></div>
        <div><span>Date</span><b>{fmtDate(date)}</b></div>
      </div>
      <div className="rx-grid">
        <aside className="rx-left">
          {vitals.length > 0 && <div className="rx-block"><h4>Vitals</h4>
            <table className="rx-vitals"><tbody>{vitals.map(([k, val, u]) => <tr key={k}><td>{k}</td><td><b>{val}</b> <small>{u}</small></td></tr>)}</tbody></table></div>}
          {v.chief_complaint && <div className="rx-block"><h4>Complaints</h4><div className="pre">{v.chief_complaint}</div></div>}
          {(bg.length > 0 || patient?.cardiac_notes) && <div className="rx-block"><h4>Background</h4><div>{bg.join(', ')}</div>{patient?.cardiac_notes && <div>{patient.cardiac_notes}</div>}</div>}
          {(exam || v.nyha_class || (v.chest_pain && v.chest_pain !== 'None')) && <div className="rx-block"><h4>Examination</h4>
            {v.chest_pain && v.chest_pain !== 'None' && <div>{v.chest_pain}</div>}
            {v.nyha_class && <div>NYHA class {v.nyha_class}</div>}
            {exam && <div>{exam}</div>}</div>}
          {(v.ecg_rhythm || v.ecg_findings || v.ecg_rate) && <div className="rx-block"><h4>ECG</h4>
            <div>{[v.ecg_rhythm, v.ecg_rate && `${v.ecg_rate}/min`, v.ecg_findings].filter(Boolean).join(', ')}</div></div>}
          {(v.echo_ef || v.echo_findings) && <div className="rx-block"><h4>Echo</h4>
            <div>{[v.echo_ef && `EF ${v.echo_ef}%`, v.echo_findings].filter(Boolean).join(', ')}</div></div>}
          {rx.investigations?.length > 0 && <div className="rx-block"><h4>Investigations advised</h4>
            <ul className="rx-tests">{rx.investigations.map((t) => <li key={t}>{t}</li>)}</ul></div>}
          {patient?.allergies && <div className="rx-block rx-allergy"><h4>Allergies</h4><div>{patient.allergies}</div></div>}
        </aside>
        <main className="rx-main">
          <div className="rx-top">
            <div className="rx-symbol">℞</div>
            {diagnosis && <div className="rx-dx"><span>Diagnosis</span><b>{diagnosis}</b></div>}
          </div>
          {meds.map((m, i) => (
            <div className="rx-med" key={i}>
              <div className="rx-med-name"><span className="n">{i + 1}.</span> <b>{medTitle(m)}</b></div>
              {lang !== 'ur' && <div className="rx-en">{englishLine(m)}{m.note ? `  ·  ${m.note}` : ''}</div>}
              {lang !== 'en' && urduLine(m) && <div className="urdu rx-ur" dir="rtl" lang="ur">{urduLine(m)}</div>}
              {lang === 'ur' && m.note && <div className="rx-en">{m.note}</div>}
            </div>
          ))}
          {!meds.length && <p className="faint">No medicines prescribed.</p>}
          {advice.length > 0 && <div className="rx-advice rx-block">
            <h4>Advice / <span className="urdu" dir="rtl" lang="ur">ہدایات</span></h4>
            <ul>{advice.map((a, i) => {
              const [en, ur] = splitAdvice(a);
              const hasUr = /[؀-ۿ]/.test(a);
              if (hasUr && ur) {
                return <li key={i}>{lang !== 'ur' && <span>{en}</span>}{lang !== 'en' && <span className="urdu" dir="rtl" lang="ur">{ur}</span>}</li>;
              }
              return <li key={i}>{hasUr ? <span className="urdu" dir="rtl" lang="ur">{a}</span> : <span>{a}</span>}</li>;
            })}</ul>
          </div>}
          {followUp && <div className="rx-fu">
            <span>Next visit: <b>{fmtDate(followUp)}</b></span>
            {lang !== 'en' && <span className="urdu" dir="rtl" lang="ur">{`دوبارہ معائنہ: ⁦${fmtDate(followUp)}⁩`}</span>}
          </div>}
        </main>
      </div>
      <Signature doctor={doctor} />
      <LetterFoot s={s} number={rx.rx_number} />
    </PrintShell>
  );
}

/* ------------------------------------------------------ Letters/certificates */
export function LetterDoc() {
  const { id } = useParams();
  const s = useSettings();
  const d = useDoc(async () => {
    const l = await db().letters.get(id);
    if (!l) return null;
    const [patient, doctor] = await Promise.all([db().patients.get(l.patient_id), db().doctors.get(l.doctor_id)]);
    return { l, patient, doctor };
  }, [id]);
  if (!d || d === NOT_FOUND || !s) return <Waiting value={d === NOT_FOUND ? null : d && s} what="Letter" />;
  const { l, patient, doctor } = d;
  return (
    <PrintShell title={letterTitle(l.kind)} filename={`${letterTitle(l.kind).replace(/\s+/g, '-')}-${l.letter_number}.pdf`}
      phone={patient?.phone} paper={s.rx_paper || 'A4'} pad={padOf(s)}
      shareText={`${letterTitle(l.kind)} for ${patient?.full_name} - ${doctor?.full_name || ''}, ${fmtDate(l.letter_date)}`}>
      <Letterhead s={s} doctor={doctor} />
      <div className="letter">
        <div className="letter-meta"><span>Ref: {l.letter_number}</span><span>Date: {fmtDate(l.letter_date)}</span></div>
        <h2 className="letter-title">{letterTitle(l.kind)}</h2>
        {l.addressed_to && <p>{l.kind === 'referral' ? 'To: ' : ''}<b>{l.addressed_to}</b></p>}
        <table className="letter-pt"><tbody>
          <tr><td>Patient</td><td><b>{patient?.full_name}</b>{guardianLine(patient) && ` (${guardianLine(patient)})`}</td></tr>
          <tr><td>Age / Sex</td><td>{[ageLabel(patient?.dob, new Date(l.letter_date)), genderLabel(patient?.gender)].filter(Boolean).join(' / ')}</td></tr>
          <tr><td>MR No.</td><td>{patient?.mr_number}{patient?.cnic ? `  ·  CNIC ${patient.cnic}` : ''}</td></tr>
          {l.diagnosis && <tr><td>Diagnosis</td><td><b>{l.diagnosis}</b></td></tr>}
          {l.from_date && <tr><td>Rest advised</td><td>{fmtDate(l.from_date)} to {fmtDate(l.to_date)}</td></tr>}
        </tbody></table>
        <div className="letter-body pre">{l.body}</div>
      </div>
      <Signature doctor={doctor} />
      <LetterFoot s={s} number={l.letter_number} />
    </PrintShell>
  );
}

/* ----------------------------------------------------------------- Invoice */
async function loadInvoice(invoiceId) {
  const inv = await db().invoices.get(invoiceId);
  if (!inv) return null;
  const [patient, items, payments, visit] = await Promise.all([
    db().patients.get(inv.patient_id),
    db().invoice_items.where('invoice_id').equals(invoiceId).toArray(),
    db().payments.where('invoice_id').equals(invoiceId).toArray(),
    inv.visit_id ? db().visits.get(inv.visit_id).catch(() => null) : null,
  ]);
  const doctor = visit?.doctor_id ? await db().doctors.get(visit.doctor_id) : (await db().doctors.toArray()).find((x) => x.active !== false) || null;
  payments.sort((a, b) => String(a.received_at).localeCompare(String(b.received_at)));
  return { inv, patient, items, payments, doctor, totals: invoiceTotals(inv, items, payments) };
}

function Totals({ t, cur }) {
  return (
    <div className="totals">
      <div><span>Subtotal</span><span>{money(t.subtotal, cur)}</span></div>
      {t.discount > 0 && <div><span>Discount</span><span>− {money(t.discount, cur)}</span></div>}
      <div className="big"><span>Total</span><span>{money(t.total, cur)}</span></div>
      <div><span>Paid</span><span>{money(t.paid, cur)}</span></div>
      <div className="big"><span>Due</span><span>{money(t.due, cur)}</span></div>
    </div>
  );
}

export function InvoiceDoc() {
  const { id } = useParams();
  const s = useSettings();
  const d = useDoc(() => loadInvoice(id), [id]);
  if (!d || d === NOT_FOUND) return <Waiting value={d === NOT_FOUND ? null : d} what="Invoice" />;
  const { inv, patient, items, payments, doctor, totals } = d;
  const cur = s?.currency || 'Rs';
  const lines = items.filter((i) => i.status !== 'cancelled');
  return (
    <PrintShell title={`Invoice ${inv.invoice_number}`} filename={`Invoice-${inv.invoice_number}.pdf`} phone={patient?.phone}
      shareText={`Invoice ${inv.invoice_number} for ${patient?.full_name}: total ${money(totals.total, cur)}, paid ${money(totals.paid, cur)}, due ${money(totals.due, cur)}`}>
      <Header s={s} doctor={doctor} />
      <PatientRow p={patient} at={inv.invoice_date} extra={[['Invoice No.', inv.invoice_number], ['Date', fmtDate(inv.invoice_date)]]} />
      <div className="doc-title">INVOICE {inv.status === 'void' && <span className="stamp" style={{ marginLeft: 10 }}>VOID</span>}</div>
      <div className="doc-body">
        <table className="doc-table">
          <thead><tr><th>#</th><th>Description</th><th className="r">Qty</th><th className="r">Rate</th><th className="r">Amount</th></tr></thead>
          <tbody>{lines.map((l, i) => (
            <tr key={l.id}><td>{i + 1}</td><td>{l.description}</td><td className="r">{Number(l.quantity)}</td>
              <td className="r">{money(l.unit_price, cur)}</td><td className="r">{money(Number(l.quantity) * Number(l.unit_price), cur)}</td></tr>
          ))}</tbody>
        </table>
        <Totals t={totals} cur={cur} />
        {payments.length > 0 && <>
          <h4 style={{ margin: '16px 0 2px', color: 'var(--navy)' }}>Payments</h4>
          <table className="doc-table"><tbody>{payments.map((p) => (
            <tr key={p.id}><td>{fmtDateTime(p.received_at)}</td><td>{p.payment_number}</td>
              <td>{p.kind === 'reversal' ? `Reversal - ${p.reason}` : methodLabel(p.method)}{p.reference ? ` (${p.reference})` : ''}</td>
              <td className="r">{money(p.amount, cur)}</td></tr>
          ))}</tbody></table>
        </>}
        {inv.status === 'void' && <p><b>Voided:</b> {inv.void_reason}</p>}
      </div>
      <div className="doc-foot"><span>{s?.invoice_footer_note || 'Thank you.'}</span><span>{inv.invoice_number}</span></div>
    </PrintShell>
  );
}

/* ----------------------------------------------------------------- Receipt */
export function ReceiptDoc() {
  const { id } = useParams();
  const s = useSettings();
  const d = useDoc(async () => {
    const pay = await db().payments.get(id);
    if (!pay) return null;
    const rest = await loadInvoice(pay.invoice_id);
    return rest && { pay, ...rest };
  }, [id]);
  if (!d || d === NOT_FOUND) return <Waiting value={d === NOT_FOUND ? null : d} what="Payment" />;
  const { pay, inv, patient, items, payments, totals } = d;
  const cur = s?.currency || 'Rs';
  // Balance right after this payment (later payments excluded).
  const upto = payments.filter((p) => String(p.received_at) <= String(pay.received_at));
  const after = invoiceTotals(inv, items, upto);
  return (
    <PrintShell title={`Receipt ${pay.payment_number}`} filename={`Receipt-${pay.payment_number}.pdf`} phone={patient?.phone}
      shareText={`Payment receipt ${pay.payment_number}: ${money(pay.amount, cur)} received from ${patient?.full_name} against invoice ${inv.invoice_number}`}>
      <Header s={s} />
      <PatientRow p={patient} at={pay.received_at} extra={[['Receipt No.', pay.payment_number], ['Date', fmtDateTime(pay.received_at)]]} />
      <div className="doc-title">PAYMENT RECEIPT {pay.kind === 'reversal' && <span className="stamp" style={{ marginLeft: 10 }}>REVERSAL</span>}</div>
      <div className="doc-body">
        <table className="doc-table"><tbody>
          <tr><td>Invoice</td><td className="r"><b>{inv.invoice_number}</b></td></tr>
          <tr><td>Amount received</td><td className="r"><b style={{ fontSize: 15 }}>{money(pay.amount, cur)}</b></td></tr>
          <tr><td>Method</td><td className="r">{methodLabel(pay.method)}{pay.reference ? ` - ${pay.reference}` : ''}</td></tr>
          {pay.reason && <tr><td>Reason</td><td className="r">{pay.reason}</td></tr>}
          <tr><td>Invoice total</td><td className="r">{money(after.total, cur)}</td></tr>
          <tr><td>Paid to date</td><td className="r">{money(after.paid, cur)}</td></tr>
          <tr><td><b>Balance due</b></td><td className="r"><b>{money(after.due, cur)}</b></td></tr>
        </tbody></table>
        {totals.due !== after.due && <p className="faint">Current balance on this invoice: {money(totals.due, cur)}</p>}
      </div>
      <div className="doc-foot"><span>{s?.invoice_footer_note || 'Thank you.'}</span><span>{pay.payment_number}</span></div>
    </PrintShell>
  );
}
