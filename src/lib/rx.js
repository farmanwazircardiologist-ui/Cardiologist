// Prescription vocabulary and the English/Urdu instruction lines printed
// under every medicine. Pure functions only (easy to test, works offline).

export const FORMS = [
  ['Tab', 'Tab.'], ['Cap', 'Cap.'], ['SL', 'SL Tab.'], ['Syp', 'Syp.'], ['Inj', 'Inj.'],
  ['Inhaler', 'Inh.'], ['Sachet', 'Sachet'], ['Drops', 'Drops'], ['Cream', 'Cream'], ['Other', ''],
];
export const formLabel = (f) => (FORMS.find((x) => x[0] === f) || [f, f ? `${f}.` : ''])[1];

export const PATTERNS = ['1+0+0', '0+1+0', '0+0+1', '1+0+1', '1+1+1', '½+0+0', '½+0+½', '0+0+½', '2+0+0', 'SOS', 'Weekly'];
export const TIMINGS = ['After meal', 'Before meal', 'With meal', 'Empty stomach', 'At bedtime'];
export const DURATIONS = ['7 days', '15 days', '1 month', '2 months', '3 months', 'Continue'];

const TIMING_UR = {
  'after meal': 'کھانے کے بعد',
  'before meal': 'کھانے سے پہلے',
  'with meal': 'کھانے کے ساتھ',
  'empty stomach': 'نہار منہ',
  'at bedtime': 'سوتے وقت',
};

// singular / plural unit per form
const UNIT_UR = {
  Tab: ['گولی', 'گولیاں'], SL: ['گولی', 'گولیاں'], Cap: ['کیپسول', 'کیپسول'], Syp: ['چمچ', 'چمچ'],
  Inj: ['انجکشن', 'انجکشن'], Inhaler: ['پف', 'پف'], Sachet: ['ساشے', 'ساشے'], Drops: ['قطرہ', 'قطرے'],
};

const TIMES_3 = ['صبح', 'دوپہر', 'رات'];
const TIMES_4 = ['صبح', 'دوپہر', 'شام', 'رات'];
const TIMES_2 = ['صبح', 'رات'];
const TIMES_EN_3 = ['morning', 'afternoon', 'night'];

const FRACTIONS = { '½': 0.5, '¼': 0.25, '¾': 0.75, '1½': 1.5, '2½': 2.5, '1/2': 0.5, '1/4': 0.25, '3/4': 0.75 };

export function qtyValue(q) {
  const s = String(q ?? '').trim();
  if (s in FRACTIONS) return FRACTIONS[s];
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

const PATTERN_RE = /^\s*[\d½¼¾./]+(\s*\+\s*[\d½¼¾./]+){1,3}\s*$/;
export const isDosePattern = (p) => PATTERN_RE.test(String(p || ''));

export function patternParts(p) {
  if (!isDosePattern(p)) return null;
  return String(p).split('+').map((x) => x.trim());
}

// "1 گولی", "آدھی گولی", "ڈیڑھ گولی", "2 گولیاں"
export function qtyUrdu(q, form = 'Tab') {
  const v = qtyValue(q);
  const [one, many] = UNIT_UR[form] || ['خوراک', 'خوراک'];
  if (v == null) return `${q} ${one}`;
  if (v === 0.5) return `آدھی ${one}`;
  if (v === 0.25) return `چوتھائی ${one}`;
  if (v === 0.75) return `پون ${one}`;
  if (v === 1.5) return `ڈیڑھ ${one}`;
  if (v === 2.5) return `ڈھائی ${many}`;
  return `${v} ${v === 1 ? one : many}`;
}

export function durationUrdu(d) {
  const s = String(d || '').trim().toLowerCase();
  if (!s) return '';
  if (s.startsWith('continue')) return 'مسلسل جاری رکھیں';
  const m = s.match(/^(\d+)\s*(day|days|d|week|weeks|w|month|months|m)\b/);
  if (!m) return d;
  const n = m[1];
  if (m[2].startsWith('d')) return `${n} دن`;
  if (m[2].startsWith('w')) return `${n} ہفتے`;
  return `${n} ماہ`;
}

// Urdu instruction line printed under a medicine (right-to-left).
export function urduLine(med) {
  if (med?.urdu?.trim()) return med.urdu.trim();
  const form = med?.form || 'Tab';
  const p = String(med?.pattern || '').trim();
  const bits = [];
  const parts = patternParts(p);
  if (parts) {
    const names = parts.length === 4 ? TIMES_4 : parts.length === 2 ? TIMES_2 : TIMES_3;
    const doses = parts.map((q, i) => (qtyValue(q) ? `${names[i]} ${qtyUrdu(q, form)}` : null)).filter(Boolean);
    if (doses.length) bits.push(doses.join('، '));
  } else if (/^sos$/i.test(p)) {
    bits.push(form === 'SL' ? 'ضرورت کے وقت 1 گولی زبان کے نیچے رکھیں' : `ضرورت کے وقت ${qtyUrdu(1, form)}`);
  } else if (/^weekly$/i.test(p)) {
    bits.push(`ہفتے میں ایک بار ${qtyUrdu(1, form)}`);
  } else if (/^stat$/i.test(p)) {
    bits.push(`ابھی ایک بار ${qtyUrdu(1, form)}`);
  } else if (p) {
    bits.push(p);
  }
  const t = TIMING_UR[String(med?.timing || '').trim().toLowerCase()];
  if (t) bits.push(t);
  const d = durationUrdu(med?.duration);
  if (d) bits.push(d);
  return bits.join(' - ');
}

// English instruction line: "1 + 0 + 1 (morning, night) · After meal · for 1 month"
export function englishLine(med) {
  const p = String(med?.pattern || '').trim();
  const bits = [];
  const parts = patternParts(p);
  if (parts) {
    const names = parts.length === 3 ? TIMES_EN_3 : parts.length === 2 ? ['morning', 'night'] : ['morning', 'afternoon', 'evening', 'night'];
    const when = parts.map((q, i) => (qtyValue(q) ? names[i] : null)).filter(Boolean);
    bits.push(`${parts.join(' + ')}${when.length ? ` (${when.join(', ')})` : ''}`);
  } else if (/^sos$/i.test(p)) bits.push('When needed (SOS)');
  else if (p) bits.push(p);
  if (med?.timing) bits.push(med.timing);
  if (med?.duration) bits.push(/^continue/i.test(med.duration) ? 'Continue' : `for ${med.duration}`);
  return bits.join('  ·  ');
}

export const medTitle = (m) => [formLabel(m?.form), m?.name].filter(Boolean).join(' ');

// ---------------- allergy warning ----------------------------------------
const GROUPS = {
  penicillin: ['amoxicillin', 'co-amoxiclav', 'augmentin', 'ampicillin', 'cloxacillin', 'flucloxacillin', 'penicillin'],
  sulfa: ['sulfamethoxazole', 'co-trimoxazole', 'sulfasalazine'],
  nsaid: ['aspirin', 'ibuprofen', 'diclofenac', 'naproxen', 'mefenamic', 'celecoxib', 'ketorolac'],
  statin: ['atorvastatin', 'rosuvastatin', 'simvastatin', 'pravastatin', 'pitavastatin'],
  ace: ['ramipril', 'lisinopril', 'enalapril', 'captopril', 'perindopril'],
  'beta blocker': ['bisoprolol', 'metoprolol', 'carvedilol', 'nebivolol', 'atenolol', 'propranolol'],
};

export function allergyTerms(allergies) {
  return String(allergies || '').toLowerCase().split(/[,;\n/]+/).map((s) => s.trim())
    .filter((s) => s.length >= 3 && !/^(none|nil|nkda|no known)/.test(s));
}

// Returns the allergy entry that matches this medicine, or null.
export function allergyHit(allergies, medName) {
  const name = String(medName || '').toLowerCase();
  if (!name.trim()) return null;
  const first = name.split(/[\s/]+/)[0];
  for (const t of allergyTerms(allergies)) {
    if (name.includes(t) || (first.length >= 4 && t.includes(first))) return t;
    for (const [g, members] of Object.entries(GROUPS)) {
      if (t.includes(g) && members.some((x) => name.includes(x))) return t;
    }
  }
  return null;
}

// ---------------- advice, investigations ---------------------------------
export const ADVICE = [
  ['Low salt diet', 'نمک کم کھائیں'],
  ['Daily 30-minute walk', 'روزانہ 30 منٹ پیدل چلیں'],
  ['Stop smoking', 'سگریٹ نوشی ترک کریں'],
  ['Check BP at home and keep a record', 'گھر پر بلڈ پریشر چیک کر کے لکھتے رہیں'],
  ['Take medicines regularly; do not stop without asking', 'دوائیں باقاعدگی سے لیں، مشورے کے بغیر بند نہ کریں'],
  ['In case of chest pain, go to emergency immediately', 'سینے میں درد کی صورت میں فوراً ایمرجنسی جائیں'],
  ['Fluid restriction 1.5 litres per day', 'دن میں ڈیڑھ لیٹر سے زیادہ پانی/مشروبات نہ لیں'],
  ['Check weight daily', 'روزانہ وزن چیک کریں'],
  ['Avoid fried and fatty food', 'تلی ہوئی اور چکنائی والی چیزوں سے پرہیز کریں'],
  ['Avoid heavy exertion', 'بھاری کام اور زیادہ مشقت سے پرہیز کریں'],
  ['Get INR checked before next visit', 'اگلی بار آنے سے پہلے INR ٹیسٹ کروائیں'],
  ['Bring all reports on next visit', 'اگلی بار تمام رپورٹس ساتھ لائیں'],
];
export const adviceLine = ([en, ur], lang = 'both') => (lang === 'en' ? en : lang === 'ur' ? ur : `${en} - ${ur}`);
// Splits a saved advice line into [english, urdu]. Older lines used a long dash.
export function splitAdvice(a) {
  const m = String(a).match(/^(.*?)\s+[\u2014\u2013-]\s+([\s\S]*[\u0600-\u06FF][\s\S]*)$/);
  return m ? [m[1], m[2]] : [String(a), null];
}
const sameAdvice = (x, y) => String(x).replace(/\u2014/g, '-').trim() === String(y).replace(/\u2014/g, '-').trim();
export { sameAdvice };

export const INVESTIGATIONS = [
  'ECG', 'Echocardiography', 'ETT (exercise tolerance test)', 'Holter 24 h', 'ABPM 24 h',
  'Coronary angiography', 'CT coronary angiography', 'Chest X-ray',
  'Lipid profile', 'HbA1c', 'FBS', 'RFT (urea, creatinine)', 'Serum electrolytes', 'LFT', 'CBC',
  'TSH', 'Troponin I', 'NT-proBNP', 'PT / INR', 'D-dimer', 'Uric acid', 'Urine R/E',
];

// ---------------- cardiac vocabulary -------------------------------------
export const RISK_FACTORS = [
  ['hypertension', 'Hypertension', 'HTN'], ['diabetes', 'Diabetes', 'DM'], ['smoker', 'Smoker', 'Smoker'],
  ['ex_smoker', 'Ex-smoker', 'Ex-smoker'], ['dyslipidemia', 'Dyslipidaemia', 'Dyslipidaemia'],
  ['family_history', 'Family history of CAD', 'FHx CAD'], ['obesity', 'Obesity', 'Obesity'], ['ckd', 'CKD', 'CKD'],
];
export const CARDIAC_HISTORY = [
  ['mi', 'Previous MI', 'Old MI'], ['pci', 'PCI / stent', 'PCI'], ['cabg', 'CABG', 'CABG'],
  ['heart_failure', 'Heart failure', 'HF'], ['af', 'Atrial fibrillation', 'AF'], ['valve', 'Valve disease', 'VHD'],
  ['prosthetic_valve', 'Prosthetic valve', 'Prosthetic valve'], ['rhd', 'Rheumatic heart disease', 'RHD'],
  ['stroke', 'Stroke / TIA', 'CVA/TIA'], ['pacemaker', 'Pacemaker / ICD', 'PPM/ICD'], ['chd', 'Congenital heart disease', 'CHD'],
];
export const ANTICOAG = [['none', 'None'], ['warfarin', 'Warfarin'], ['doac', 'DOAC (apixaban / rivaroxaban / dabigatran)'], ['other', 'Other']];

const labelOf = (list, idx) => (k) => (list.find((x) => x[0] === k) || [k, k, k])[idx];
export const riskLabel = labelOf(RISK_FACTORS, 1);
export const riskShort = labelOf(RISK_FACTORS, 2);
export const historyLabel = labelOf(CARDIAC_HISTORY, 1);
export const historyShort = labelOf(CARDIAC_HISTORY, 2);

export const CHOICES = {
  chest_pain: ['None', 'Typical angina', 'Atypical chest pain', 'Non-cardiac chest pain'],
  rhythm: ['Regular', 'Irregular', 'Irregularly irregular'],
  heart_sounds: ['S1 S2 normal', 'S3 present', 'S4 present', 'Muffled'],
  murmur: ['None', 'Ejection systolic murmur', 'Pansystolic murmur', 'Diastolic murmur'],
  jvp: ['Not raised', 'Raised'],
  edema: ['None', 'Pedal +', 'Pedal ++', 'Pedal +++'],
  chest_exam: ['Clear', 'Bibasal crackles', 'Wheeze', 'Reduced air entry'],
  ecg_rhythm: ['Sinus rhythm', 'Sinus tachycardia', 'Sinus bradycardia', 'Atrial fibrillation', 'Atrial flutter', 'Paced rhythm'],
  ecg_findings: ['Normal ECG', 'LVH', 'ST depression', 'ST elevation', 'T wave inversion', 'Q waves (old MI)', 'LBBB', 'RBBB', '1st degree AV block', 'Poor R wave progression', 'Ventricular ectopics'],
  echo_findings: ['Normal LV function', 'LV systolic dysfunction', 'Diastolic dysfunction', 'RWMA', 'LVH', 'Dilated LV', 'MR', 'AS', 'MS', 'AR', 'TR', 'Pulmonary hypertension', 'Pericardial effusion'],
};

// Toggle a phrase inside a comma separated text (multi-pick chips).
export function togglePhrase(text, phrase) {
  const list = String(text || '').split(',').map((s) => s.trim()).filter(Boolean);
  const i = list.findIndex((x) => x.toLowerCase() === phrase.toLowerCase());
  if (i >= 0) list.splice(i, 1); else list.push(phrase);
  return list.join(', ');
}
export const hasPhrase = (text, phrase) => String(text || '').split(',').some((s) => s.trim().toLowerCase() === phrase.toLowerCase());

const kindTitle = (k) => ({ echo: 'Echocardiography', stress_echo: 'Stress echo', tee: 'TEE', holter: 'Holter', tmt: 'Treadmill test', abpm: 'ABPM', cath: 'Cardiac catheterization', device: 'Device implantation' }[k] || k);

// ---------------- letters -------------------------------------------------
export const LETTER_KINDS = [
  ['referral', 'Referral letter'], ['medical', 'Medical certificate'],
  ['fitness', 'Fitness certificate'], ['sick_leave', 'Sick leave certificate'], ['discharge', 'Discharge summary'],
];
export const letterTitle = (k) => (LETTER_KINDS.find((x) => x[0] === k) || [k, k])[1];

// Starting text for a new letter; the doctor edits it before printing.
export function letterDraft(kind, { patient, visit, rx, doctor, from, to, report, implants = [] } = {}) {
  const name = patient?.full_name || 'the patient';
  const pr = patient?.gender === 'female' ? 'She' : 'He';
  const pos = patient?.gender === 'female' ? 'her' : 'his';
  const dx = rx?.diagnosis || visit?.diagnosis || '';
  const meds = (rx?.medicines || []).filter((m) => m.name).map((m) => medTitle(m)).join(', ');
  const vit = visit?.bp_systolic ? `BP ${visit.bp_systolic}/${visit.bp_diastolic} mmHg, pulse ${visit.pulse || '-'}/min.` : '';
  const dr = doctor?.full_name || 'the undersigned';
  if (kind === 'referral') {
    return [
      `Kindly see ${name}, who is under my care${dx ? ` for ${dx}` : ''}.`,
      visit?.chief_complaint ? `Presenting complaint: ${visit.chief_complaint}.` : '',
      vit,
      visit?.ecg_findings ? `ECG: ${[visit.ecg_rhythm, visit.ecg_findings].filter(Boolean).join(', ')}.` : '',
      visit?.echo_ef ? `Echo: EF ${visit.echo_ef}%${visit.echo_findings ? `, ${visit.echo_findings}` : ''}.` : '',
      meds ? `Current medicines: ${meds}.` : '',
      'Referred for further evaluation and management. Thank you.',
    ].filter(Boolean).join('\n');
  }
  if (kind === 'discharge') {
    const dx = rx?.diagnosis || visit?.diagnosis || '';
    const proc = report ? (report.impression || '').split('\n').map((l) => l.replace(/^\d+\.\s*/, '')).filter(Boolean).join('\n') : '';
    const imp = implants.filter((i) => i.brand || i.model || i.serial_no)
      .map((i) => `${[i.brand, i.model].filter(Boolean).join(' ')}${i.size ? ` ${i.size}` : ''}${i.site ? ` (${i.site})` : ''}${i.serial_no ? `, serial/lot ${i.serial_no}` : ''}`).join('\n');
    const d = report?.data || {};
    const dapt = d.dapt_drug && d.dapt_drug !== 'Not needed' ? `Aspirin plus ${d.dapt_drug}${d.dapt_months ? ` for ${d.dapt_months}` : ''}. Do not stop without asking the doctor.` : '';
    return [
      `${name} was admitted${from ? ` on ${from}` : ''}${dx ? ` with ${dx}` : ''}${visit?.chief_complaint ? `. Presenting complaint: ${visit.chief_complaint}` : ''}.`,
      vit,
      report ? `Procedure: ${kindTitle(report.kind)}${report.data?.access ? ` via ${String(report.data.access).toLowerCase()}` : ''}.` : '',
      proc ? `Findings:\n${proc}` : '',
      imp ? `Implants:\n${imp}` : '',
      `Hospital course was uneventful. ${pr} was stable at discharge${to ? ` on ${to}` : ''}.`,
      meds ? `Discharge medicines: ${meds}.` : '',
      dapt ? `Antiplatelet plan: ${dapt}` : '',
      rx?.follow_up_date ? `Follow-up: please come again on ${rx.follow_up_date}.` : 'Follow-up: please come again after one week, or earlier if chest pain, breathlessness, bleeding or swelling at the puncture site.',
    ].filter(Boolean).join('\n\n');
  }
  if (kind === 'medical') {
    return `This is to certify that ${name} is under my treatment${dx ? ` for ${dx}` : ''}. ${pr} has been advised regular medication and follow-up.`;
  }
  if (kind === 'fitness') {
    return `This is to certify that I have examined ${name}. From a cardiac point of view, ${pos} condition is stable and ${pr.toLowerCase()} is fit to resume normal duties.`;
  }
  if (kind === 'sick_leave') {
    return `This is to certify that ${name} is under my treatment${dx ? ` for ${dx}` : ''} and is advised rest${from && to ? ` from ${from} to ${to}` : ''}.`;
  }
  return `Signed: ${dr}`;
}
