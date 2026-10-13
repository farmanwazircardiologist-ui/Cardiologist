// Cardiac reports (echo, stress echo, TEE, Holter, TMT, ABPM, cath lab, devices).
// Each kind is a SCHEMA (sections of fields). The same schema draws the form,
// the printed report, the normal-value check and the impression draft, so a new
// field is added in one place only. Values live in cardiac_reports.data (jsonb).

export const STUDY_KINDS = [
  ['echo', 'Echocardiography'],
  ['stress_echo', 'Stress echo'],
  ['tee', 'TEE'],
  ['holter', 'Holter (24 h ECG)'],
  ['tmt', 'TMT / ETT (treadmill)'],
  ['abpm', 'ABPM (24 h BP)'],
  ['cath', 'Cath lab (angiography / PCI)'],
  ['device', 'Pacemaker / ICD / CRT'],
];
export const kindLabel = (k) => (STUDY_KINDS.find((x) => x[0] === k) || [k, k])[1];
export const KIND_SERVICE = {
  echo: 'Echocardiography', stress_echo: 'Stress echo', tee: 'TEE (Transesophageal echo)',
  holter: 'Holter monitoring (24 h)', tmt: 'ETT (Exercise tolerance test)', abpm: 'ABPM (24 h BP monitoring)',
  cath: 'Coronary angiography', device: 'Pacemaker implantation',
};

export const n = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
const r1 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10) / 10);
const r2 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
const r0 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x));

// ---------------------------------------------------------------- calculations
export const bsa = (h, w) => (n(h) && n(w) ? r2(Math.sqrt((n(h) * n(w)) / 3600)) : null); // Mosteller
export const lvMass = (ivs, lvid, pw) => { // Devereux, mm in, grams out
  const a = n(ivs), b = n(lvid), c = n(pw);
  if (a == null || b == null || c == null) return null;
  const [x, y, z] = [a / 10, b / 10, c / 10];
  return r0(0.8 * 1.04 * ((x + y + z) ** 3 - y ** 3) + 0.6);
};
export const fractionalShortening = (dd, ds) => (n(dd) && n(ds) != null ? r1(((n(dd) - n(ds)) / n(dd)) * 100) : null);
export const teichholzEF = (dd, ds) => {
  const a = n(dd), b = n(ds);
  if (!a || b == null) return null;
  const v = (d) => (7 / (2.4 + d / 10)) * (d / 10) ** 3;
  return r0(((v(a) - v(b)) / v(a)) * 100);
};
export const efFromVolumes = (edv, esv) => (n(edv) && n(esv) != null && n(edv) > 0 ? r0(((n(edv) - n(esv)) / n(edv)) * 100) : null);
export const rapFromIvc = (diam, collapse) => {
  const d = n(diam);
  if (d == null || !collapse) return null;
  const down = collapse === 'More than 50%';
  if (d <= 21 && down) return 3;
  if (d > 21 && !down) return 15;
  return 8;
};
export const rvsp = (trVel, rap) => (n(trVel) && rap != null ? r0(4 * n(trVel) ** 2 + rap) : null);
export const avaContinuity = (lvotD, lvotVti, avVti) => (n(lvotD) && n(lvotVti) && n(avVti) ? r2((0.785 * (n(lvotD) / 10) ** 2 * n(lvotVti)) / n(avVti)) : null);
export const dvi = (lvotV, avV) => (n(lvotV) && n(avV) ? r2(n(lvotV) / n(avV)) : null);
export const mvaPht = (pht) => (n(pht) ? r2(220 / n(pht)) : null);
export const qpqs = (rvotD, rvotVti, lvotD, lvotVti) => {
  const qp = n(rvotD) && n(rvotVti) ? 0.785 * (n(rvotD) / 10) ** 2 * n(rvotVti) : null;
  const qs = n(lvotD) && n(lvotVti) ? 0.785 * (n(lvotD) / 10) ** 2 * n(lvotVti) : null;
  return qp && qs ? r2(qp / qs) : null;
};
export const mpHr = (age) => (n(age) ? 220 - n(age) : null);
export const brucMets = (minutes) => { // Bruce treadmill protocol, ACSM estimate
  const t = n(minutes);
  if (t == null || t <= 0) return null;
  return r1((14.8 - 1.379 * t + 0.451 * t * t - 0.012 * t ** 3) / 3.5); // Foster formula: ml/kg/min divided by 3.5
};
export const duke = (minutes, stMm, angina) => (n(minutes) != null && n(stMm) != null && n(angina) != null ? r0(n(minutes) - 5 * n(stMm) - 4 * n(angina)) : null);
export const dukeRisk = (s) => (s == null ? null : s >= 5 ? 'Low risk' : s >= -10 ? 'Intermediate risk' : 'High risk');
export const dipping = (day, night) => (n(day) && n(night) != null ? r1(((n(day) - n(night)) / n(day)) * 100) : null);
export const dipPattern = (p) => (p == null ? null : p >= 20 ? 'Extreme dipper' : p >= 10 ? 'Dipper' : p >= 0 ? 'Non-dipper' : 'Reverse dipper');

// 17-segment wall motion. A string of 17 digits: 1 normal, 2 hypokinetic, 3 akinetic,
// 4 dyskinetic, 5 aneurysmal. Missing = not assessed.
export const SEG_STATES = [[1, 'Normal'], [2, 'Hypokinetic'], [3, 'Akinetic'], [4, 'Dyskinetic'], [5, 'Aneurysmal']];
export const SEG_NAMES = [
  'Basal anterior', 'Basal anteroseptal', 'Basal inferoseptal', 'Basal inferior', 'Basal inferolateral', 'Basal anterolateral',
  'Mid anterior', 'Mid anteroseptal', 'Mid inferoseptal', 'Mid inferior', 'Mid inferolateral', 'Mid anterolateral',
  'Apical anterior', 'Apical septal', 'Apical inferior', 'Apical lateral', 'Apex',
];
const TERRITORY = { LAD: [1, 2, 7, 8, 13, 14, 17], RCA: [3, 4, 9, 10, 15], LCx: [5, 6, 11, 12, 16] };
export const segArray = (s) => (typeof s === 'string' && s.length === 17 && /^[1-5]+$/.test(s) ? s.split('').map(Number) : null);
export const wmsi = (s) => {
  const a = segArray(s);
  return a ? r2(a.reduce((x, y) => x + y, 0) / 17) : null;
};
export function wallMotionText(s) {
  const a = segArray(s);
  if (!a) return null;
  const bad = a.map((v, i) => [v, i + 1]).filter(([v]) => v > 1);
  if (!bad.length) return 'No regional wall motion abnormality';
  const worst = Math.max(...bad.map(([v]) => v));
  const word = SEG_STATES.find((x) => x[0] === worst)[1].toLowerCase();
  const terr = Object.entries(TERRITORY).filter(([, segs]) => bad.some(([, i]) => segs.includes(i))).map(([t]) => t);
  return `Regional wall motion abnormality (${bad.length} segment${bad.length > 1 ? 's' : ''}, worst ${word}) in ${terr.join(' and ')} territory`;
}

// ---------------------------------------------------------------- field builders
const num = (k, label, unit, o = {}) => ({ t: 'num', k, label, unit, ...o });
const pick = (k, label, options, o = {}) => ({ t: 'pick', k, label, options, ...o });
const text = (k, label, o = {}) => ({ t: 'text', k, label, ...o });
const calc = (k, label, unit, fn, o = {}) => ({ t: 'calc', k, label, unit, fn, ...o });

const NONE_SEV = ['None', 'Trivial', 'Mild', 'Moderate', 'Severe'];
const STEN_SEV = ['None', 'Mild', 'Moderate', 'Severe'];
const YESNO = ['No', 'Yes'];

const VALVES = [['mv', 'Mitral valve', 'MV', 'mitral'], ['av', 'Aortic valve', 'AV', 'aortic'], ['tv', 'Tricuspid valve', 'TV', 'tricuspid'], ['pv', 'Pulmonary valve', 'PV', 'pulmonary']];

// ---------------------------------------------------------------- echo
const echoSections = () => [
  {
    id: 'hdr', title: 'Study details', open: true, fields: [
      pick('indication', 'Indication', ['Chest pain', 'Breathlessness', 'Palpitations', 'Syncope', 'Murmur', 'Hypertension', 'Post MI', 'Heart failure', 'Pre-operative', 'Follow-up', 'Screening'], { multi: true }),
      pick('quality', 'Image quality', ['Good', 'Fair', 'Poor']),
      pick('rhythm', 'Rhythm', ['Sinus', 'Atrial fibrillation', 'Paced', 'Other']),
      num('hr', 'Heart rate', '/min'), text('bp', 'Blood pressure', { short: true, placeholder: '120/80' }),
      num('height_cm', 'Height', 'cm'), num('weight_kg', 'Weight', 'kg'),
      calc('bsa', 'BSA', 'm²', (d) => bsa(d.height_cm, d.weight_kg)),
    ],
  },
  {
    id: 'lv', title: 'Left ventricle', open: true, fields: [
      num('lvidd', 'LVIDd', 'mm', { norm: { m: [42, 58], f: [38, 52] } }),
      num('lvids', 'LVIDs', 'mm', { norm: { m: [25, 40], f: [22, 35] } }),
      num('ivsd', 'IVSd', 'mm', { norm: { m: [6, 10], f: [6, 9] } }),
      num('lvpwd', 'LVPWd', 'mm', { norm: { m: [6, 10], f: [6, 9] } }),
      num('ef', 'EF (reported)', '%', { norm: { m: [52, 72], f: [54, 74] }, quick: [20, 25, 30, 35, 40, 45, 50, 55, 60, 65] }),
      pick('ef_method', 'EF method', ['Simpson biplane', 'Teichholz', 'Visual estimate', '3D']),
      num('edv', 'EDV', 'mL'), num('esv', 'ESV', 'mL'),
      calc('ef_vol', 'EF from volumes', '%', (d) => efFromVolumes(d.edv, d.esv), { norm: { m: [52, 72], f: [54, 74] } }),
      calc('ef_teich', 'EF from dimensions (Teichholz)', '%', (d) => teichholzEF(d.lvidd, d.lvids), { norm: { m: [52, 72], f: [54, 74] } }),
      calc('fs', 'Fractional shortening', '%', (d) => fractionalShortening(d.lvidd, d.lvids), { norm: [25, 43] }),
      calc('lv_mass', 'LV mass', 'g', (d) => lvMass(d.ivsd, d.lvidd, d.lvpwd)),
      calc('lvmi', 'LV mass index', 'g/m²', (d, o) => (o.lv_mass && o.bsa ? r0(o.lv_mass / o.bsa) : null), { norm: { m: [49, 115], f: [43, 95] } }),
      calc('rwt', 'Relative wall thickness', '', (d) => (n(d.lvpwd) && n(d.lvidd) ? r2((2 * n(d.lvpwd)) / n(d.lvidd)) : null), { norm: [0.2, 0.42] }),
      pick('lv_size', 'LV size', ['Normal', 'Mildly dilated', 'Moderately dilated', 'Severely dilated', 'Small']),
      pick('lv_wall', 'LV wall', ['Normal', 'Concentric LVH', 'Eccentric LVH', 'Concentric remodelling', 'Asymmetric septal hypertrophy']),
      pick('lv_func', 'LV systolic function', ['Normal', 'Borderline', 'Mildly reduced', 'Moderately reduced', 'Severely reduced'], { hint: 'Filled from EF if left empty' }),
      { t: 'seg17', k: 'seg', label: 'Wall motion (17 segments)' },
      calc('wmsi_c', 'Wall motion score index', '', (d) => wmsi(d.seg), { norm: [1, 1] }),
      num('gls', 'Global longitudinal strain', '%', { norm: [null, -18] }),
      pick('lv_thrombus', 'LV thrombus', ['None', 'Present']),
    ],
  },
  {
    id: 'dia', title: 'Diastolic function', fields: [
      num('e_vel', 'Mitral E', 'cm/s'), num('a_vel', 'Mitral A', 'cm/s'),
      calc('e_a', 'E/A ratio', '', (d) => (n(d.e_vel) && n(d.a_vel) ? r2(n(d.e_vel) / n(d.a_vel)) : null), { norm: [0.8, 2.0] }),
      num('dt', 'Deceleration time', 'ms', { norm: [160, 240] }),
      num('e_sep', "e' septal", 'cm/s', { norm: [7, null] }), num('e_lat', "e' lateral", 'cm/s', { norm: [10, null] }),
      calc('e_ee', "E/e' (average)", '', (d) => (n(d.e_vel) && n(d.e_sep) && n(d.e_lat) ? r1(n(d.e_vel) / ((n(d.e_sep) + n(d.e_lat)) / 2)) : null), { norm: [0, 14] }),
      pick('diastolic', 'Diastolic function', ['Normal', 'Grade I (impaired relaxation)', 'Grade II (pseudonormal)', 'Grade III (restrictive)', 'Indeterminate']),
      pick('lap', 'LA pressure', ['Normal', 'Raised']),
    ],
  },
  {
    id: 'atria', title: 'Atria and right heart', fields: [
      num('la_diam', 'LA diameter', 'mm', { norm: { m: [30, 40], f: [27, 38] } }),
      num('la_vol', 'LA volume', 'mL'),
      calc('lavi', 'LA volume index', 'mL/m²', (d, o) => (n(d.la_vol) && o.bsa ? r0(n(d.la_vol) / o.bsa) : null), { norm: [16, 34] }),
      pick('la_size', 'LA size', ['Normal', 'Mildly dilated', 'Moderately dilated', 'Severely dilated']),
      pick('ra_size', 'RA size', ['Normal', 'Dilated']),
      pick('rv_size', 'RV size', ['Normal', 'Mildly dilated', 'Moderately dilated', 'Severely dilated']),
      num('rv_basal', 'RV basal diameter', 'mm', { norm: [20, 41] }),
      num('tapse', 'TAPSE', 'mm', { norm: [17, null] }), num('rv_s', "RV S'", 'cm/s', { norm: [9.5, null] }),
      pick('rv_func', 'RV systolic function', ['Normal', 'Mildly reduced', 'Moderately reduced', 'Severely reduced']),
    ],
  },
  ...VALVES.map(([p, title, abbr]) => ({
    id: p, title, fields: [
      text(`${p}_morph`, 'Morphology', { placeholder: p === 'mv' ? 'e.g. thickened, calcified, prolapse, restricted' : 'e.g. trileaflet, bicuspid, calcified' }),
      pick(`${p}_st`, 'Stenosis', STEN_SEV),
      pick(`${p}_reg`, 'Regurgitation', NONE_SEV),
      ...(p === 'mv' ? [
        num('mv_mean', 'Mean gradient', 'mmHg'), num('mv_pht', 'Pressure half-time', 'ms'),
        calc('mva', 'MVA (PHT)', 'cm²', (d) => mvaPht(d.mv_pht), { norm: [4, 6] }),
        num('mv_vc', 'MR vena contracta', 'mm'), num('mv_eroa', 'MR EROA', 'mm²'), num('mv_rvol', 'MR regurgitant volume', 'mL'),
        pick('mv_mech', 'MR mechanism', ['Primary (degenerative)', 'Rheumatic', 'Functional', 'Ischemic', 'Endocarditis']),
        num('wilkins', 'Wilkins score', '/16'),
      ] : []),
      ...(p === 'av' ? [
        num('av_vmax', 'AV Vmax', 'm/s', { norm: [0.9, 2.0] }), num('av_peak', 'Peak gradient', 'mmHg'), num('av_mean', 'Mean gradient', 'mmHg'),
        num('lvot_d', 'LVOT diameter', 'mm'), num('lvot_vti', 'LVOT VTI', 'cm'), num('av_vti', 'AV VTI', 'cm'), num('lvot_v', 'LVOT Vmax', 'm/s'),
        calc('ava', 'AVA (continuity)', 'cm²', (d) => avaContinuity(d.lvot_d, d.lvot_vti, d.av_vti), { norm: [2, null] }),
        calc('dvi', 'Dimensionless index', '', (d) => dvi(d.lvot_v, d.av_vmax), { norm: [0.5, null] }),
        num('ar_vc', 'AR vena contracta', 'mm'), num('ar_pht', 'AR pressure half-time', 'ms'),
      ] : []),
      ...(p === 'tv' ? [
        num('tr_vel', 'TR peak velocity', 'm/s', { norm: [0, 2.8] }),
        calc('tr_grad', 'TR peak gradient', 'mmHg', (d) => (n(d.tr_vel) ? r0(4 * n(d.tr_vel) ** 2) : null), { norm: [0, 31] }),
        num('tr_vc', 'TR vena contracta', 'mm'),
      ] : []),
      ...(p === 'pv' ? [num('pv_vmax', 'PV Vmax', 'm/s', { norm: [0.5, 1.6] }), num('pv_peak', 'Peak gradient', 'mmHg')] : []),
    ],
  })),
  {
    id: 'aorta', title: 'Aorta, pulmonary pressure and IVC', fields: [
      num('ao_root', 'Aortic root', 'mm', { norm: { m: [31, 40], f: [27, 36] } }),
      num('ao_asc', 'Ascending aorta', 'mm', { norm: [20, 38] }),
      num('ao_arch', 'Arch', 'mm', { norm: [20, 36] }),
      num('ivc_d', 'IVC diameter', 'mm', { norm: [0, 21] }),
      pick('ivc_c', 'IVC collapse', ['More than 50%', 'Less than 50%']),
      calc('rap', 'Right atrial pressure', 'mmHg', (d) => rapFromIvc(d.ivc_d, d.ivc_c)),
      calc('rvsp', 'RVSP / PASP', 'mmHg', (d, o) => rvsp(d.tr_vel, o.rap), { norm: [0, 35] }),
      num('pat', 'Pulmonary acceleration time', 'ms', { norm: [120, null] }),
    ],
  },
  {
    id: 'other', title: 'Pericardium, masses, shunts, prosthesis', fields: [
      pick('effusion', 'Pericardial effusion', ['None', 'Trivial', 'Small', 'Moderate', 'Large']),
      num('eff_mm', 'Effusion depth', 'mm'),
      pick('tamponade', 'Tamponade signs', ['No', 'Yes']),
      pick('mass', 'Mass / thrombus / vegetation', ['None', 'LV thrombus', 'LA thrombus', 'Vegetation', 'Mass']),
      text('mass_note', 'Mass details'),
      pick('shunt', 'Shunt', ['None', 'ASD', 'VSD', 'PDA', 'PFO']),
      num('shunt_mm', 'Defect size', 'mm'),
      pick('shunt_dir', 'Shunt direction', ['Left to right', 'Right to left', 'Bidirectional']),
      num('rvot_d', 'RVOT diameter', 'mm'), num('rvot_vti', 'RVOT VTI', 'cm'),
      calc('qpqs', 'Qp:Qs', '', (d) => qpqs(d.rvot_d, d.rvot_vti, d.lvot_d, d.lvot_vti), { norm: [0.9, 1.1] }),
      pick('prosthesis', 'Prosthetic valve', ['None', 'Mitral mechanical', 'Mitral bioprosthetic', 'Aortic mechanical', 'Aortic bioprosthetic', 'TAVI', 'Ring / repair']),
      text('pros_note', 'Prosthesis details (gradients, leak, size)'),
    ],
  },
  {
    id: 'cm', title: 'Cardiomyopathy and special', fields: [
      num('max_wall', 'Maximum wall thickness (HCM)', 'mm', { norm: [0, 15] }),
      num('lvot_grad', 'LVOT gradient', 'mmHg'),
      pick('sam', 'Systolic anterior motion', ['No', 'Yes']),
      pick('bubble', 'Bubble (saline contrast) study', ['Not done', 'Negative', 'Positive']),
      pick('contrast', 'Contrast echo', ['Not done', 'Done']),
      text('other_find', 'Other findings'),
    ],
  },
];

// ---------------------------------------------------------------- stress echo
const stressSections = () => [
  {
    id: 'hdr', title: 'Study details', open: true, fields: [
      pick('indication', 'Indication', ['Chest pain', 'Known CAD', 'Post MI', 'Viability', 'Pre-operative', 'Valve disease', 'Screening'], { multi: true }),
      pick('protocol', 'Stress type', ['Treadmill exercise (Bruce)', 'Dobutamine']),
      pick('meds_held', 'Beta blocker', ['Held', 'Not held']),
      num('rest_hr', 'Resting HR', '/min'), text('rest_bp', 'Resting BP', { short: true, placeholder: '120/80' }),
      num('peak_hr', 'Peak HR', '/min'), text('peak_bp', 'Peak BP', { short: true, placeholder: '180/90' }),
      num('exercise_min', 'Exercise time', 'min'),
      calc('mets', 'METs (Bruce estimate)', '', (d) => (String(d.protocol || '').startsWith('Treadmill') ? brucMets(d.exercise_min) : null)),
      calc('pct_mphr', '% of maximum predicted HR', '%', (d, o, c) => (n(d.peak_hr) && mpHr(c.age) ? r0((n(d.peak_hr) / mpHr(c.age)) * 100) : null), { norm: [85, null] }),
      pick('stop', 'Reason for stopping', ['Target HR reached', 'Fatigue', 'Chest pain', 'Breathlessness', 'ST changes', 'Arrhythmia', 'Hypotension', 'Hypertensive response', 'Dobutamine max dose']),
      pick('ecg_resp', 'ECG response', ['No ischemic ST change', 'Ischemic ST depression', 'ST elevation', 'Arrhythmia', 'Uninterpretable']),
      pick('symptoms', 'Symptoms', ['None', 'Typical angina', 'Atypical chest pain', 'Breathlessness', 'Dizziness'], { multi: true }),
    ],
  },
  {
    id: 'rest', title: 'Rest', open: true, fields: [
      num('ef_rest', 'EF at rest', '%', { norm: { m: [52, 72], f: [54, 74] } }),
      { t: 'seg17', k: 'seg_rest', label: 'Wall motion at rest' },
      calc('wmsi_rest', 'WMSI at rest', '', (d) => wmsi(d.seg_rest), { norm: [1, 1] }),
    ],
  },
  {
    id: 'peak', title: 'Peak stress / post stress', open: true, fields: [
      num('ef_peak', 'EF at peak', '%'),
      { t: 'seg17', k: 'seg_peak', label: 'Wall motion at peak' },
      calc('wmsi_peak', 'WMSI at peak', '', (d) => wmsi(d.seg_peak), { norm: [1, 1] }),
      pick('result', 'Result', ['Negative for inducible ischemia', 'Positive for inducible ischemia', 'Viable myocardium', 'Non-viable myocardium', 'Non-diagnostic (sub-maximal)']),
    ],
  },
];

// ---------------------------------------------------------------- TEE
const teeSections = () => [
  {
    id: 'hdr', title: 'Procedure', open: true, fields: [
      pick('indication', 'Indication', ['Source of embolism', 'Endocarditis', 'Prosthetic valve', 'Mitral valve assessment', 'LAA thrombus before cardioversion', 'Aortic pathology', 'Congenital / shunt', 'Poor transthoracic window'], { multi: true }),
      pick('sedation', 'Sedation', ['Topical only', 'Midazolam', 'Propofol']),
      pick('tolerance', 'Procedure tolerated', ['Well', 'With difficulty', 'Complication']),
      text('complication', 'Complication details'),
      pick('rhythm', 'Rhythm', ['Sinus', 'Atrial fibrillation', 'Paced', 'Other']),
    ],
  },
  {
    id: 'find', title: 'Findings', open: true, fields: [
      pick('laa', 'Left atrial appendage', ['No thrombus', 'Thrombus present', 'Sludge', 'Not seen well']),
      num('laa_vel', 'LAA emptying velocity', 'cm/s', { norm: [40, null] }),
      pick('sec', 'Spontaneous echo contrast', ['None', 'Mild', 'Moderate', 'Dense (smoke)']),
      pick('ias', 'Interatrial septum', ['Intact', 'PFO', 'ASD', 'Atrial septal aneurysm']),
      pick('bubble', 'Bubble study', ['Not done', 'Negative', 'Positive']),
      pick('veg', 'Vegetation', ['None', 'Mitral', 'Aortic', 'Tricuspid', 'Lead / device']),
      text('veg_note', 'Vegetation size and details'),
      pick('abscess', 'Abscess / perforation', ['None', 'Abscess', 'Perforation', 'Pseudoaneurysm']),
      pick('mv_find', 'Mitral valve', ['Normal', 'Rheumatic MS', 'Prolapse', 'Flail leaflet', 'Calcific', 'Prosthetic']),
      pick('mr', 'MR', NONE_SEV),
      pick('av_find', 'Aortic valve', ['Normal', 'Calcific AS', 'Bicuspid', 'Prosthetic']),
      pick('ar', 'AR', NONE_SEV),
      pick('atheroma', 'Aortic atheroma', ['None', 'Grade I', 'Grade II', 'Grade III', 'Grade IV', 'Grade V (mobile)']),
      pick('lv_func', 'LV function', ['Normal', 'Mildly reduced', 'Moderately reduced', 'Severely reduced']),
      num('ef', 'EF', '%', { norm: { m: [52, 72], f: [54, 74] } }),
      pick('effusion', 'Pericardial effusion', ['None', 'Trivial', 'Small', 'Moderate', 'Large']),
      text('other_find', 'Other findings'),
    ],
  },
];

// ---------------------------------------------------------------- Holter
const holterSections = () => [
  {
    id: 'hdr', title: 'Recording', open: true, fields: [
      pick('indication', 'Indication', ['Palpitations', 'Syncope / presyncope', 'Dizziness', 'Known arrhythmia', 'AF burden', 'Post ablation', 'Drug effect', 'Pacemaker check'], { multi: true }),
      num('hours', 'Recording duration', 'h'), text('start', 'Start date and time', { short: true }),
      num('beats', 'Total beats', ''), pick('rhythm', 'Basic rhythm', ['Sinus', 'Atrial fibrillation', 'Atrial flutter', 'Paced', 'Other']),
    ],
  },
  {
    id: 'hr', title: 'Heart rate', open: true, fields: [
      num('min_hr', 'Minimum HR', '/min', { norm: [40, null] }), text('min_time', 'at', { short: true, placeholder: 'time' }),
      num('avg_hr', 'Average HR', '/min', { norm: [50, 90] }),
      num('max_hr', 'Maximum HR', '/min', { norm: [null, 160] }), text('max_time', 'at', { short: true, placeholder: 'time' }),
      num('sdnn', 'SDNN', 'ms', { norm: [100, null] }),
    ],
  },
  {
    id: 'ect', title: 'Ectopics and arrhythmias', open: true, fields: [
      num('vpc', 'Ventricular ectopics (VPC)', 'beats'),
      calc('vpc_pct', 'VPC burden', '%', (d) => (n(d.vpc) != null && n(d.beats) ? r1((n(d.vpc) / n(d.beats)) * 100) : null), { norm: [0, 1] }),
      num('couplets', 'VPC couplets', ''), num('vt_runs', 'Ventricular tachycardia runs', ''), text('vt_detail', 'Longest VT (beats, rate)', { short: true }),
      num('sve', 'Supraventricular ectopics (SVE)', 'beats'), num('svt_runs', 'SVT runs', ''), text('svt_detail', 'Longest SVT (beats, rate)', { short: true }),
      num('af_burden', 'AF burden', '%', { norm: [0, 0] }),
      num('pauses', 'Pauses over 2 seconds', ''), num('longest_pause', 'Longest pause', 's', { norm: [0, 2] }),
      pick('av_block', 'AV block', ['None', 'First degree', 'Mobitz I', 'Mobitz II', 'Complete']),
      pick('st', 'ST segment', ['No significant change', 'ST depression', 'ST elevation']),
      pick('symptoms', 'Symptoms in diary', ['None recorded', 'Palpitations', 'Dizziness', 'Chest pain', 'Syncope'], { multi: true }),
      pick('corr', 'Symptom correlation', ['Not applicable', 'No arrhythmia with symptoms', 'Arrhythmia with symptoms']),
    ],
  },
];

// ---------------------------------------------------------------- TMT
const tmtSections = () => [
  {
    id: 'hdr', title: 'Test details', open: true, fields: [
      pick('indication', 'Indication', ['Chest pain', 'Known CAD', 'Post MI', 'Post PCI / CABG', 'Pre-operative', 'Arrhythmia', 'Screening', 'Fitness'], { multi: true }),
      pick('protocol', 'Protocol', ['Bruce', 'Modified Bruce', 'Other']),
      pick('meds', 'Beta blocker / drugs', ['Held', 'Not held']),
      num('rest_hr', 'Resting HR', '/min'), text('rest_bp', 'Resting BP', { short: true, placeholder: '120/80' }),
      pick('rest_ecg', 'Resting ECG', ['Normal', 'LVH', 'Old MI', 'LBBB', 'RBBB', 'ST-T changes', 'Paced', 'AF']),
    ],
  },
  {
    id: 'ex', title: 'Exercise', open: true, fields: [
      num('minutes', 'Exercise time', 'min'),
      calc('mets', 'METs achieved (Bruce estimate)', '', (d) => (d.protocol === 'Bruce' ? brucMets(d.minutes) : null), { norm: [7, null] }),
      num('mets_m', 'METs (enter if other protocol)', ''),
      num('peak_hr', 'Peak HR', '/min'),
      calc('target', '85% of maximum predicted HR', '/min', (d, o, c) => (mpHr(c.age) ? r0(0.85 * mpHr(c.age)) : null)),
      calc('pct_mphr', '% of maximum predicted HR', '%', (d, o, c) => (n(d.peak_hr) && mpHr(c.age) ? r0((n(d.peak_hr) / mpHr(c.age)) * 100) : null), { norm: [85, null] }),
      text('peak_bp', 'Peak BP', { short: true, placeholder: '180/90' }),
      pick('bp_resp', 'BP response', ['Normal', 'Hypertensive', 'Hypotensive / drop']),
      num('hr_rec', 'HR recovery at 1 min', 'bpm', { norm: [12, null] }),
      pick('stop', 'Reason for stopping', ['Target HR reached', 'Fatigue', 'Chest pain', 'Breathlessness', 'ST changes', 'Arrhythmia', 'Hypotension', 'Hypertensive response', 'Leg pain', 'Patient request']),
    ],
  },
  {
    id: 'res', title: 'Response', open: true, fields: [
      pick('symptoms', 'Symptoms', ['None', 'Typical angina', 'Atypical chest pain', 'Breathlessness', 'Dizziness'], { multi: true }),
      pick('angina', 'Angina index', ['0 - none', '1 - non-limiting', '2 - exercise limiting']),
      pick('st', 'ST segment', ['No significant change', 'Horizontal depression', 'Downsloping depression', 'Upsloping depression', 'ST elevation']),
      num('st_mm', 'Maximum ST deviation', 'mm', { norm: [0, 0.9] }),
      text('st_leads', 'Leads involved', { short: true }),
      pick('st_when', 'ST change appears', ['Not applicable', 'Early (stage 1 or 2)', 'Mid exercise', 'Peak exercise', 'Recovery only']),
      pick('arrhythmia', 'Arrhythmia', ['None', 'Occasional VPCs', 'Frequent VPCs', 'Couplets', 'NSVT', 'SVT', 'AF']),
      calc('duke_c', 'Duke treadmill score', '', (d) => duke(d.minutes, d.st_mm ?? 0, String(d.angina || '0').slice(0, 1)), { norm: [5, null] }),
      pick('result', 'Result', ['Negative for inducible ischemia', 'Positive for inducible ischemia', 'Equivocal', 'Non-diagnostic (sub-maximal)']),
    ],
  },
];

// ---------------------------------------------------------------- ABPM
const abpmSections = () => [
  {
    id: 'hdr', title: 'Recording', open: true, fields: [
      pick('indication', 'Indication', ['Diagnosis of hypertension', 'White coat suspected', 'Masked hypertension suspected', 'Resistant hypertension', 'Treatment review', 'Nocturnal hypertension'], { multi: true }),
      num('hours', 'Recording duration', 'h', { norm: [24, null] }), num('readings', 'Valid readings', ''),
      text('meds', 'Antihypertensives taken'),
    ],
  },
  {
    id: 'means', title: 'Averages (mmHg)', open: true, fields: [
      num('h24_s', '24 h systolic', 'mmHg', { norm: [null, 129] }), num('h24_d', '24 h diastolic', 'mmHg', { norm: [null, 79] }),
      num('day_s', 'Day systolic', 'mmHg', { norm: [null, 134] }), num('day_d', 'Day diastolic', 'mmHg', { norm: [null, 84] }),
      num('night_s', 'Night systolic', 'mmHg', { norm: [null, 119] }), num('night_d', 'Night diastolic', 'mmHg', { norm: [null, 69] }),
      num('max_s', 'Highest systolic', 'mmHg'), num('max_d', 'Highest diastolic', 'mmHg'),
      num('load_s', 'Systolic load (day)', '%', { norm: [0, 30] }), num('pulse', 'Mean pulse', '/min'),
      calc('dip', 'Night dip (systolic)', '%', (d) => dipping(d.day_s, d.night_s), { norm: [10, 20] }),
      calc('dip_pat', 'Dipping pattern', '', (d, o) => dipPattern(o.dip)),
    ],
  },
  {
    id: 'cls', title: 'Classification', open: true, fields: [
      pick('class', 'Blood pressure status', ['Normal', 'White coat hypertension', 'Masked hypertension', 'Sustained hypertension', 'Controlled on treatment', 'Uncontrolled on treatment', 'Nocturnal hypertension']),
      text('clinic_bp', 'Clinic BP for comparison', { short: true }),
    ],
  },
];

// ---------------------------------------------------------------- cath lab
const VESSELS = [['lm', 'Left main'], ['lad', 'LAD'], ['d1', 'Diagonal'], ['lcx', 'LCx'], ['om', 'OM'], ['ramus', 'Ramus'], ['rca', 'RCA'], ['pda', 'PDA / PLV']];
const cathSections = () => [
  {
    id: 'hdr', title: 'Procedure', open: true, fields: [
      pick('proc', 'Procedure', ['Diagnostic coronary angiography', 'PCI (angioplasty)', 'Angiography and PCI', 'Right heart catheterization', 'Other'], { multi: true }),
      pick('indication', 'Indication', ['Stable angina', 'Unstable angina', 'NSTEMI', 'STEMI (primary PCI)', 'Positive stress test', 'Heart failure / cardiomyopathy', 'Pre-operative', 'Valve disease work-up'], { multi: true }),
      pick('access', 'Access', ['Right radial', 'Left radial', 'Right femoral', 'Left femoral', 'Ulnar']),
      num('sheath', 'Sheath size', 'F'),
      pick('anticoag', 'Anticoagulation', ['Heparin', 'Bivalirudin', 'None']),
      text('contrast_type', 'Contrast', { short: true, placeholder: 'e.g. Iohexol' }), num('contrast_ml', 'Contrast volume', 'mL'),
      num('fluoro_min', 'Fluoroscopy time', 'min'), num('dose', 'Radiation dose (air kerma)', 'mGy'),
      pick('dominance', 'Dominance', ['Right', 'Left', 'Co-dominant']),
    ],
  },
  { id: 'vessels', title: 'Coronary findings', open: true, fields: [{ t: 'vessels', k: 'vessels', label: 'Stenosis by vessel', vessels: VESSELS }] },
  {
    id: 'hemo', title: 'Haemodynamics and LV', fields: [
      pick('lv_gram', 'LV gram', ['Not done', 'Done']),
      num('lv_ef', 'LV EF', '%'), num('lvedp', 'LVEDP', 'mmHg', { norm: [null, 12] }),
      pick('mr_gram', 'Mitral regurgitation on LV gram', ['None', 'Mild', 'Moderate', 'Severe']),
      num('ao_s', 'Aortic pressure systolic', 'mmHg'), num('ao_d', 'Aortic pressure diastolic', 'mmHg'),
      num('pcwp', 'PCWP', 'mmHg'), num('pa_m', 'Mean PA pressure', 'mmHg'),
    ],
  },
  {
    id: 'pci', title: 'PCI details', fields: [
      pick('pci_vessels', 'Vessels treated', ['LM', 'LAD', 'Diagonal', 'LCx', 'OM', 'Ramus', 'RCA', 'PDA / PLV', 'Graft'], { multi: true }),
      pick('lesion', 'Lesion type', ['A', 'B1', 'B2', 'C', 'Bifurcation', 'Chronic total occlusion', 'In-stent restenosis']),
      num('pre_pct', 'Stenosis before', '%'), num('post_pct', 'Residual stenosis after', '%'),
      pick('timi_pre', 'TIMI flow before', ['0', '1', '2', '3']), pick('timi_post', 'TIMI flow after', ['0', '1', '2', '3']),
      pick('tech', 'Technique', ['Predilatation', 'Direct stenting', 'Post dilatation', 'IVUS guided', 'OCT guided', 'Rotablation', 'Thrombus aspiration', 'Intra-aortic balloon', 'Cutting balloon'], { multi: true }),
      pick('result_pci', 'Result', ['Successful', 'Partial', 'Failed']),
      { t: 'implants', k: 'implants', label: 'Stents and devices left in the patient', kinds: ['stent', 'closure_device', 'other'] },
    ],
  },
  {
    id: 'after', title: 'Complications and plan', open: true, fields: [
      pick('complication', 'Complications', ['None', 'Access site hematoma', 'Radial artery spasm', 'Dissection', 'No reflow', 'Perforation', 'Contrast reaction', 'Arrhythmia', 'Vascular complication'], { multi: true }),
      pick('closure', 'Haemostasis', ['Manual compression', 'Radial band', 'Closure device']),
      pick('rec', 'Recommendation', ['Medical management', 'PCI advised', 'CABG advised', 'Heart team discussion', 'Further tests']),
      pick('dapt_drug', 'DAPT second drug', ['Clopidogrel', 'Ticagrelor', 'Prasugrel', 'Not needed']),
      pick('dapt_months', 'DAPT duration', ['1 month', '3 months', '6 months', '12 months']),
      text('plan', 'Post procedure plan', { rows: 2 }),
    ],
  },
];

// ---------------------------------------------------------------- devices
const deviceSections = () => [
  {
    id: 'hdr', title: 'Device and procedure', open: true, fields: [
      pick('visit_type', 'Entry type', ['Implantation', 'Follow-up check', 'Generator change', 'Lead revision', 'Upgrade', 'Explant']),
      pick('device', 'Device', ['Single chamber pacemaker', 'Dual chamber pacemaker', 'CRT-P', 'ICD single chamber', 'ICD dual chamber', 'CRT-D', 'Leadless pacemaker', 'Implantable loop recorder']),
      pick('indication', 'Indication', ['Complete heart block', 'Sick sinus syndrome', 'Symptomatic bradycardia', 'AF with slow response', 'Mobitz II', 'Primary prevention (low EF)', 'Secondary prevention (VT/VF)', 'Heart failure with LBBB', 'Syncope'], { multi: true }),
      pick('side', 'Implant side', ['Left', 'Right']),
      pick('mri', 'MRI conditional', ['Yes', 'No', 'Unknown']),
      text('operator', 'Operator / centre', { short: true }),
    ],
  },
  { id: 'impl', title: 'Generator and leads (serial numbers)', open: true, fields: [{ t: 'implants', k: 'implants', label: 'Generator and leads', kinds: ['pacemaker', 'icd', 'crt', 'other'], lead: true }] },
  {
    id: 'prog', title: 'Settings and measurements', open: true, fields: [
      pick('mode', 'Mode', ['AAI', 'VVI', 'DDD', 'DDDR', 'VVIR', 'AAIR', 'VOO', 'DOO', 'CRT']),
      num('lower', 'Lower rate', '/min'), num('upper', 'Upper sensor rate', '/min'),
      num('ra_thr', 'RA threshold', 'V'), num('ra_sense', 'RA sensing', 'mV'), num('ra_imp', 'RA impedance', 'ohm'),
      num('rv_thr', 'RV threshold', 'V'), num('rv_sense', 'RV sensing', 'mV'), num('rv_imp', 'RV impedance', 'ohm'),
      num('lv_thr', 'LV threshold', 'V'), num('lv_imp', 'LV impedance', 'ohm'),
      num('pulse_w', 'Pulse width', 'ms'), num('output', 'Output amplitude', 'V'),
      num('battery_v', 'Battery voltage', 'V'), num('longevity', 'Estimated longevity', 'years'),
      num('pct_pace_a', 'Atrial pacing', '%'), num('pct_pace_v', 'Ventricular pacing', '%'),
      pick('events', 'Events since last check', ['None', 'AT/AF episodes', 'VT episodes', 'Therapies delivered (shock/ATP)', 'Lead alert']),
      pick('complication', 'Complications', ['None', 'Pocket hematoma', 'Infection', 'Lead displacement', 'Pneumothorax', 'Perforation']),
      text('plan', 'Plan', { rows: 2 }), text('next_check', 'Next check due', { short: true, placeholder: 'e.g. 3 months' }),
    ],
  },
];

const BUILDERS = { echo: echoSections, stress_echo: stressSections, tee: teeSections, holter: holterSections, tmt: tmtSections, abpm: abpmSections, cath: cathSections, device: deviceSections };
export const sectionsFor = (kind) => (BUILDERS[kind] || (() => []))();
const allFields = (kind) => sectionsFor(kind).flatMap((s) => s.fields);

// ---------------------------------------------------------------- norms and calcs
export function normOf(f, ctx = {}) {
  if (!f.norm) return null;
  if (Array.isArray(f.norm)) return f.norm;
  return f.norm[ctx.sex === 'female' ? 'f' : 'm'] || null;
}
export function normText(f, ctx) {
  const r = normOf(f, ctx);
  if (!r) return '';
  const [lo, hi] = r;
  if (lo == null && hi == null) return '';
  if (lo == null) return `up to ${hi}`;
  if (hi == null) return `${lo} or more`;
  return lo === hi ? `${lo}` : `${lo} to ${hi}`;
}
// 'low' | 'high' | null
export function flagOf(f, value, ctx) {
  const v = n(value), r = normOf(f, ctx);
  if (v == null || !r) return null;
  if (r[0] != null && v < r[0]) return 'low';
  if (r[1] != null && v > r[1]) return 'high';
  return null;
}

// All calculated values for a report. ctx = { sex, age }
export function computeAll(kind, d = {}, ctx = {}) {
  const out = {};
  for (const f of allFields(kind)) {
    if (f.t === 'calc') {
      let v = null;
      try { v = f.fn(d, out, ctx); } catch { v = null; }
      if (v != null && v !== '') out[f.k] = v;
    }
  }
  return out;
}

export function efOf(kind, d = {}, calcs = {}) {
  if (kind === 'stress_echo') return n(d.ef_rest);
  return n(d.ef) ?? n(calcs.ef_vol) ?? n(calcs.ef_teich) ?? (kind === 'cath' ? n(d.lv_ef) : null);
}
export const efWord = (ef) => (ef == null ? null : ef >= 55 ? 'normal' : ef >= 50 ? 'borderline (low normal)' : ef >= 41 ? 'mildly reduced' : ef >= 30 ? 'moderately reduced' : 'severely reduced');

// ---------------------------------------------------------------- normal templates
export function normalTemplate(kind) {
  const all = '1'.repeat(17);
  if (kind === 'echo') {
    return {
      quality: 'Good', rhythm: 'Sinus', ef: 60, ef_method: 'Visual estimate', lv_size: 'Normal', lv_wall: 'Normal', seg: all,
      lv_thrombus: 'None', diastolic: 'Normal', lap: 'Normal', la_size: 'Normal', ra_size: 'Normal', rv_size: 'Normal', rv_func: 'Normal',
      mv_morph: 'Normal', mv_st: 'None', mv_reg: 'None', av_morph: 'Trileaflet, normal', av_st: 'None', av_reg: 'None',
      tv_morph: 'Normal', tv_st: 'None', tv_reg: 'None', pv_morph: 'Normal', pv_st: 'None', pv_reg: 'None',
      ivc_c: 'More than 50%', effusion: 'None', tamponade: 'No', mass: 'None', shunt: 'None', prosthesis: 'None', sam: 'No', bubble: 'Not done', contrast: 'Not done',
    };
  }
  if (kind === 'stress_echo') return { seg_rest: all, seg_peak: all, ef_rest: 60, ef_peak: 70, ecg_resp: 'No ischemic ST change', symptoms: ['None'], result: 'Negative for inducible ischemia' };
  if (kind === 'tee') return { laa: 'No thrombus', sec: 'None', ias: 'Intact', bubble: 'Not done', veg: 'None', abscess: 'None', mr: 'None', ar: 'None', atheroma: 'None', lv_func: 'Normal', effusion: 'None', tolerance: 'Well' };
  if (kind === 'holter') return { rhythm: 'Sinus', av_block: 'None', st: 'No significant change', symptoms: ['None recorded'], corr: 'Not applicable' };
  if (kind === 'tmt') return { rest_ecg: 'Normal', symptoms: ['None'], angina: '0 - none', st: 'No significant change', st_mm: 0, arrhythmia: 'None', bp_resp: 'Normal', result: 'Negative for inducible ischemia' };
  if (kind === 'abpm') return { class: 'Normal' };
  if (kind === 'cath') return { complication: ['None'], vessels: { lm: { pct: 0 }, lad: { pct: 0 }, lcx: { pct: 0 }, rca: { pct: 0 } }, timi_pre: '3' };
  return {};
}

// Values taken from the visit and patient when a new report is opened.
export function prefill(kind, { visit, patient } = {}) {
  const d = {};
  if (['echo', 'stress_echo'].includes(kind) || kind === 'tmt') {
    if (visit?.pulse && kind === 'echo') d.hr = visit.pulse;
    if (visit?.bp_systolic && kind === 'echo') d.bp = `${visit.bp_systolic}/${visit.bp_diastolic || ''}`.replace(/\/$/, '');
    if (visit?.height_cm && kind === 'echo') d.height_cm = visit.height_cm;
    if (visit?.weight_kg && kind === 'echo') d.weight_kg = visit.weight_kg;
    if (visit?.pulse && kind === 'tmt') d.rest_hr = visit.pulse;
    if (visit?.bp_systolic && kind === 'tmt') d.rest_bp = `${visit.bp_systolic}/${visit.bp_diastolic || ''}`.replace(/\/$/, '');
  }
  if (kind === 'echo' && patient?.cardiac_history?.includes('af')) d.rhythm = 'Atrial fibrillation';
  return d;
}

// ---------------------------------------------------------------- impression drafts
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const isReal = (v) => v && !['None', 'No', 'Not done', 'Normal'].includes(v);

function valveLines(d, calcs) {
  const lines = [];
  for (const [p, , abbr, word] of VALVES) {
    const st = d[`${p}_st`], reg = d[`${p}_reg`];
    if (st && st !== 'None') {
      let extra = '';
      if (p === 'av') extra = [calcs.ava != null && `AVA ${calcs.ava} cm²`, n(d.av_mean) != null && `mean gradient ${d.av_mean} mmHg`, n(d.av_vmax) != null && `Vmax ${d.av_vmax} m/s`].filter(Boolean).join(', ');
      if (p === 'mv') extra = [calcs.mva != null && `MVA ${calcs.mva} cm²`, n(d.mv_mean) != null && `mean gradient ${d.mv_mean} mmHg`].filter(Boolean).join(', ');
      if (p === 'pv') extra = n(d.pv_peak) != null ? `peak gradient ${d.pv_peak} mmHg` : '';
      lines.push(`${st} ${word} stenosis${extra ? ` (${extra})` : ''}`);
    }
    if (reg && reg !== 'None' && reg !== 'Trivial') lines.push(`${reg} ${abbr === 'MV' ? 'mitral' : abbr === 'AV' ? 'aortic' : abbr === 'TV' ? 'tricuspid' : 'pulmonary'} regurgitation`);
  }
  return lines;
}

function echoImpression(d, calcs, ctx) {
  const lines = [];
  const ef = efOf('echo', d, calcs);
  const lvBits = [];
  if (d.lv_size && d.lv_size !== 'Normal') lvBits.push(`${d.lv_size.toLowerCase()} LV`);
  else if ((!d.lv_size || d.lv_size === 'Normal') && n(d.lvidd) != null && flagOf(allFields('echo').find((f) => f.k === 'lvidd'), d.lvidd, ctx) === 'high') lvBits.push(`dilated LV (LVIDd ${d.lvidd} mm)`);
  if (d.lv_wall && d.lv_wall !== 'Normal') lvBits.push(d.lv_wall);
  else if (calcs.lvmi != null && flagOf(allFields('echo').find((f) => f.k === 'lvmi'), calcs.lvmi, ctx) === 'high') lvBits.push(`${calcs.rwt > 0.42 ? 'concentric' : 'eccentric'} LV hypertrophy (LV mass index ${calcs.lvmi} g/m²)`);
  const efText = ef != null ? `LV systolic function is ${efWord(ef)} (EF ${ef}%${d.ef_method ? `, ${d.ef_method.toLowerCase()}` : ''})` : (d.lv_func ? `LV systolic function is ${d.lv_func.toLowerCase()}` : '');
  if (lvBits.length || efText) lines.push(cap([lvBits.join(', '), efText].filter(Boolean).join('. ')));
  const wm = wallMotionText(d.seg);
  if (wm) lines.push(`${wm}${calcs.wmsi_c && calcs.wmsi_c > 1 ? ` (WMSI ${calcs.wmsi_c})` : ''}`);
  const baseCount = lines.length;
  if (n(d.gls) != null && n(d.gls) > -18) lines.push(`Reduced global longitudinal strain (${d.gls}%)`);
  if (d.diastolic && d.diastolic !== 'Normal') lines.push(`${d.diastolic.split(' (')[0]} diastolic dysfunction${d.lap === 'Raised' ? ' with raised LA pressure' : ''}`);
  else if (calcs.e_ee != null && calcs.e_ee > 14) lines.push(`Raised filling pressure (E/e' ${calcs.e_ee})`);
  if (d.la_size && d.la_size !== 'Normal') lines.push(`${d.la_size.replace(' dilated', '')} left atrial enlargement`);
  else if (calcs.lavi != null && calcs.lavi > 34) lines.push(`Left atrial enlargement (LAVI ${calcs.lavi} mL/m²)`);
  if (d.ra_size === 'Dilated') lines.push('Right atrial dilatation');
  const rvBits = [];
  if (d.rv_size && d.rv_size !== 'Normal') rvBits.push(`${d.rv_size.toLowerCase()} RV`);
  if (d.rv_func && d.rv_func !== 'Normal') rvBits.push(`${d.rv_func.toLowerCase()} RV systolic function`);
  else if (n(d.tapse) != null && n(d.tapse) < 17) rvBits.push(`reduced RV function (TAPSE ${d.tapse} mm)`);
  if (rvBits.length) lines.push(cap(rvBits.join(', ')));
  lines.push(...valveLines(d, calcs).map(cap));
  if (d.prosthesis && d.prosthesis !== 'None') lines.push(`${d.prosthesis}${d.pros_note ? `: ${d.pros_note}` : ''}`);
  if (calcs.rvsp != null) {
    if (calcs.rvsp > 35) lines.push(`${calcs.rvsp > 70 ? 'Severe' : calcs.rvsp > 50 ? 'Moderate' : 'Mild'} pulmonary hypertension (estimated PASP ${calcs.rvsp} mmHg)`);
  }
  if (d.effusion && d.effusion !== 'None') lines.push(`${d.effusion} pericardial effusion${d.tamponade === 'Yes' ? ' with signs of tamponade' : ', no tamponade'}`);
  if (isReal(d.mass)) lines.push(`${d.mass}${d.mass_note ? `: ${d.mass_note}` : ''}`);
  if (d.lv_thrombus === 'Present') lines.push('LV thrombus present');
  if (isReal(d.shunt)) lines.push(`${d.shunt}${n(d.shunt_mm) ? ` (${d.shunt_mm} mm)` : ''}${d.shunt_dir ? `, ${d.shunt_dir.toLowerCase()} shunt` : ''}${calcs.qpqs ? `, Qp:Qs ${calcs.qpqs}` : ''}`);
  if (n(d.max_wall) != null && n(d.max_wall) >= 15) lines.push(`Hypertrophic cardiomyopathy pattern (maximum wall thickness ${d.max_wall} mm${n(d.lvot_grad) ? `, LVOT gradient ${d.lvot_grad} mmHg` : ''}${d.sam === 'Yes' ? ', SAM present' : ''})`);
  if (d.bubble === 'Positive') lines.push('Positive bubble study (right to left shunt)');
  if (n(d.ao_root) != null && flagOf(allFields('echo').find((f) => f.k === 'ao_root'), d.ao_root, ctx) === 'high') lines.push(`Dilated aortic root (${d.ao_root} mm)`);
  if (n(d.ao_asc) != null && n(d.ao_asc) > 38) lines.push(`Dilated ascending aorta (${d.ao_asc} mm)`);
  if (d.other_find) lines.push(d.other_find);

  const wmNormal = !wm || /No regional/.test(wm);
  if (ef != null && ef >= 55 && !lvBits.length && wmNormal && lines.length === baseCount) {
    return [`Normal study: normal LV size and systolic function (EF ${ef}%), no regional wall motion abnormality, no significant valvular disease, no pericardial effusion.`];
  }
  return lines;
}

function stressImpression(d, calcs) {
  const lines = [];
  if (d.protocol) lines.push(`${d.protocol} stress echocardiography${calcs.mets ? `, ${calcs.mets} METs` : ''}${calcs.pct_mphr ? `, ${calcs.pct_mphr}% of maximum predicted heart rate` : ''}`);
  if (calcs.pct_mphr != null && calcs.pct_mphr < 85 && !String(d.protocol || '').startsWith('Dobut')) lines.push('Sub-maximal heart rate response, so a negative result is less reliable');
  const a = wallMotionText(d.seg_rest), b = wallMotionText(d.seg_peak);
  if (a) lines.push(`At rest: ${a.toLowerCase()}${n(d.ef_rest) ? `, EF ${d.ef_rest}%` : ''}`);
  if (b) lines.push(`At peak: ${b.toLowerCase()}${n(d.ef_peak) ? `, EF ${d.ef_peak}%` : ''}`);
  if (calcs.wmsi_rest && calcs.wmsi_peak && calcs.wmsi_peak > calcs.wmsi_rest) lines.push(`WMSI rose from ${calcs.wmsi_rest} to ${calcs.wmsi_peak}`);
  if (d.result) lines.push(cap(d.result));
  return lines;
}

function teeImpression(d) {
  const lines = [];
  if (d.laa) lines.push(`Left atrial appendage: ${d.laa.toLowerCase()}${n(d.laa_vel) ? ` (emptying velocity ${d.laa_vel} cm/s)` : ''}`);
  if (isReal(d.sec) ) lines.push(`${d.sec} spontaneous echo contrast`);
  if (d.ias && d.ias !== 'Intact') lines.push(`${d.ias} of the interatrial septum${d.bubble === 'Positive' ? ' with positive bubble study' : ''}`);
  if (isReal(d.veg)) lines.push(`Vegetation: ${d.veg}${d.veg_note ? ` (${d.veg_note})` : ''}`);
  if (isReal(d.abscess)) lines.push(`${d.abscess} seen`);
  if (isReal(d.mv_find)) lines.push(`Mitral valve: ${d.mv_find}`);
  if (isReal(d.mr) && d.mr !== 'Trivial') lines.push(`${d.mr} mitral regurgitation`);
  if (isReal(d.av_find)) lines.push(`Aortic valve: ${d.av_find}`);
  if (isReal(d.ar) && d.ar !== 'Trivial') lines.push(`${d.ar} aortic regurgitation`);
  if (isReal(d.atheroma)) lines.push(`Aortic atheroma ${d.atheroma.toLowerCase()}`);
  if (n(d.ef) != null) lines.push(`LV systolic function ${efWord(n(d.ef))} (EF ${d.ef}%)`);
  if (isReal(d.effusion)) lines.push(`${d.effusion} pericardial effusion`);
  if (isReal(d.tolerance) && d.tolerance !== 'Well') lines.push(`Procedure ${d.tolerance.toLowerCase()}${d.complication ? `: ${d.complication}` : ''}`);
  if (d.other_find) lines.push(d.other_find);
  if (d.laa === 'No thrombus' && !lines.slice(1).length) lines.push('No intracardiac thrombus, vegetation or significant abnormality');
  return lines;
}

function holterImpression(d, calcs) {
  const lines = [];
  const rate = [n(d.min_hr) != null && `minimum ${d.min_hr}`, n(d.avg_hr) != null && `average ${d.avg_hr}`, n(d.max_hr) != null && `maximum ${d.max_hr}`].filter(Boolean).join(', ');
  lines.push(`${d.rhythm || 'Rhythm'} for ${n(d.hours) || 24} hours${rate ? `; heart rate ${rate} /min` : ''}`);
  if (n(d.vpc)) lines.push(`Ventricular ectopics ${d.vpc}${calcs.vpc_pct != null ? ` (${calcs.vpc_pct}% burden${calcs.vpc_pct >= 10 ? ', high burden' : ''})` : ''}${n(d.couplets) ? `, ${d.couplets} couplets` : ''}`);
  if (n(d.vt_runs)) lines.push(`Non-sustained VT: ${d.vt_runs} run(s)${d.vt_detail ? `, ${d.vt_detail}` : ''}`);
  if (n(d.sve)) lines.push(`Supraventricular ectopics ${d.sve}`);
  if (n(d.svt_runs)) lines.push(`SVT: ${d.svt_runs} run(s)${d.svt_detail ? `, ${d.svt_detail}` : ''}`);
  if (n(d.af_burden)) lines.push(`Atrial fibrillation burden ${d.af_burden}%`);
  if (n(d.pauses)) lines.push(`${d.pauses} pause(s) over 2 seconds, longest ${d.longest_pause || '-'} s`);
  if (isReal(d.av_block)) lines.push(`${d.av_block} AV block`);
  if (d.st && d.st !== 'No significant change') lines.push(d.st);
  if (d.corr && d.corr !== 'Not applicable') lines.push(d.corr);
  const arr = !!(n(d.vt_runs) || n(d.pauses) || n(d.af_burden) || n(d.svt_runs) || isReal(d.av_block) || (calcs.vpc_pct != null && calcs.vpc_pct >= 1));
  if (!arr && lines.length) lines.push('No significant arrhythmia, pause or ST change in the recording');
  return lines;
}

function tmtImpression(d, calcs) {
  const lines = [];
  const mets = calcs.mets ?? n(d.mets_m);
  lines.push(`${d.protocol || 'Treadmill'} protocol: ${n(d.minutes) ? `${d.minutes} min` : ''}${mets ? `, ${mets} METs` : ''}${calcs.pct_mphr ? `, ${calcs.pct_mphr}% of maximum predicted heart rate` : ''}${d.stop ? `. Stopped for ${d.stop.toLowerCase()}` : ''}`.replace(/^([^:]+): ,/, '$1:'));
  if (calcs.pct_mphr != null && calcs.pct_mphr < 85) lines.push('Sub-maximal test (target heart rate not reached)');
  if (d.st && d.st !== 'No significant change') lines.push(`${d.st}${n(d.st_mm) ? ` (${d.st_mm} mm)` : ''}${d.st_leads ? ` in ${d.st_leads}` : ''}${d.st_when && d.st_when !== 'Not applicable' ? `, ${d.st_when.toLowerCase()}` : ''}`);
  const sy = (Array.isArray(d.symptoms) ? d.symptoms : []).filter((x) => x && x !== 'None');
  if (sy.length) lines.push(`Symptoms: ${sy.join(', ').toLowerCase()}`);
  if (isReal(d.arrhythmia)) lines.push(`Arrhythmia: ${d.arrhythmia.toLowerCase()}`);
  if (d.bp_resp && d.bp_resp !== 'Normal') lines.push(`${d.bp_resp} blood pressure response`);
  if (calcs.duke_c != null) lines.push(`Duke treadmill score ${calcs.duke_c} (${dukeRisk(calcs.duke_c).toLowerCase()})`);
  if (d.result) lines.push(cap(d.result));
  return lines;
}

function abpmImpression(d, calcs) {
  const lines = [];
  const pair = (s, di) => (n(s) != null && n(di) != null ? `${s}/${di}` : null);
  const parts = [['24 h', pair(d.h24_s, d.h24_d)], ['day', pair(d.day_s, d.day_d)], ['night', pair(d.night_s, d.night_d)]].filter((x) => x[1]).map(([k, v]) => `${k} ${v}`);
  if (parts.length) lines.push(`Average BP: ${parts.join(', ')} mmHg`);
  const high = [];
  if ((n(d.h24_s) ?? 0) >= 130 || (n(d.h24_d) ?? 0) >= 80) high.push('24 hour');
  if ((n(d.day_s) ?? 0) >= 135 || (n(d.day_d) ?? 0) >= 85) high.push('daytime');
  if ((n(d.night_s) ?? 0) >= 120 || (n(d.night_d) ?? 0) >= 70) high.push('night-time');
  if (parts.length) lines.push(high.length ? `Raised ${high.join(', ')} average (ESH thresholds 130/80, 135/85, 120/70)` : 'All averages are within the normal limits');
  if (calcs.dip != null) lines.push(`${calcs.dip_pat} pattern (night fall ${calcs.dip}%)`);
  if (d.class) lines.push(d.class);
  return lines;
}

function cathImpression(d) {
  const lines = [];
  const v = d.vessels || {};
  const pct = (k) => n(v[k]?.pct);
  const sig = (k) => (pct(k) != null && pct(k) >= (k === 'lm' ? 50 : 70));
  const major = ['lad', 'lcx', 'rca'].filter(sig);
  const parts = VESSELS.filter(([k]) => pct(k) != null && pct(k) > 0).map(([k, name]) => `${name} ${pct(k)}%${v[k]?.note ? ` (${v[k].note})` : ''}`);
  if (sig('lm')) lines.push(`Significant left main disease (${pct('lm')}%)`);
  if (major.length) lines.push(`${['Single', 'Double', 'Triple'][major.length - 1]} vessel coronary artery disease: ${major.map((k) => k.toUpperCase().replace('LCX', 'LCx')).join(', ')}`);
  else if (parts.length && !sig('lm')) lines.push('No haemodynamically significant coronary stenosis (all under 70%)');
  else if (VESSELS.some(([k]) => pct(k) === 0) && !parts.length) lines.push('Normal coronary arteries');
  if (parts.length) lines.push(`Findings: ${parts.join(', ')}`);
  if (d.dominance) lines.push(`${d.dominance} dominant circulation`);
  if (n(d.lv_ef) != null) lines.push(`LV EF ${d.lv_ef}%${n(d.lvedp) != null ? `, LVEDP ${d.lvedp} mmHg` : ''}`);
  const pciOn = [].concat(d.proc || []).some((x) => /PCI/.test(x));
  if (pciOn) lines.push(`PCI to ${[].concat(d.pci_vessels || []).join(', ') || 'target vessel'}${n(d.pre_pct) != null && n(d.post_pct) != null ? ` (${d.pre_pct}% to ${d.post_pct}%)` : ''}${d.timi_post ? `, final TIMI ${d.timi_post}` : ''}${d.result_pci ? `, ${d.result_pci.toLowerCase()}` : ''}`);
  const comp = [].concat(d.complication || []).filter((x) => x && x !== 'None');
  lines.push(comp.length ? `Complications: ${comp.join(', ').toLowerCase()}` : 'No complication');
  if (d.rec) lines.push(`Recommendation: ${d.rec}`);
  if (d.dapt_drug && d.dapt_drug !== 'Not needed') lines.push(`DAPT: aspirin plus ${d.dapt_drug.toLowerCase()}${d.dapt_months ? ` for ${d.dapt_months}` : ''}`);
  return lines;
}

function deviceImpression(d, calcs) {
  const lines = [];
  if (d.visit_type || d.device) lines.push(`${[d.visit_type, d.device].filter(Boolean).join(': ')}${d.side ? `, ${d.side.toLowerCase()} side` : ''}`);
  if (d.mode) lines.push(`Mode ${d.mode}${n(d.lower) ? `, lower rate ${d.lower}/min` : ''}`);
  const meas = [n(d.rv_thr) != null && `RV threshold ${d.rv_thr} V`, n(d.rv_sense) != null && `RV sensing ${d.rv_sense} mV`, n(d.rv_imp) != null && `RV impedance ${d.rv_imp} ohm`].filter(Boolean);
  if (meas.length) lines.push(meas.join(', '));
  if (n(d.battery_v) != null || n(d.longevity) != null) lines.push(`Battery ${n(d.battery_v) != null ? `${d.battery_v} V` : ''}${n(d.longevity) != null ? `, estimated longevity ${d.longevity} years` : ''}`.replace('Battery ,', 'Battery'));
  if (n(d.pct_pace_v) != null) lines.push(`Ventricular pacing ${d.pct_pace_v}%${n(d.pct_pace_a) != null ? `, atrial pacing ${d.pct_pace_a}%` : ''}`);
  if (isReal(d.events)) lines.push(d.events);
  const comp = d.complication;
  lines.push(isReal(comp) ? `Complication: ${comp.toLowerCase()}` : 'Device functioning normally, no complication');
  void calcs;
  return lines;
}

export function buildImpression(kind, d = {}, ctx = {}) {
  const calcs = computeAll(kind, d, ctx);
  const fn = { echo: echoImpression, stress_echo: stressImpression, tee: teeImpression, holter: holterImpression, tmt: tmtImpression, abpm: abpmImpression, cath: cathImpression, device: deviceImpression }[kind];
  const lines = fn ? fn(d, calcs, ctx) : [];
  return lines.filter(Boolean).map((x) => x.replace(/\s+/g, ' ').trim()).map((x, i) => `${i + 1}. ${cap(x)}`).join('\n');
}

// Key numbers compared with the previous report of the same kind.
export const COMPARE_KEYS = {
  echo: ['ef', 'lvidd', 'lvids', 'ivsd', 'lvpwd', 'lvmi', 'lavi', 'tapse', 'rvsp', 'wmsi_c', 'av_mean', 'mva'],
  stress_echo: ['ef_rest', 'ef_peak', 'wmsi_rest', 'wmsi_peak'],
  holter: ['avg_hr', 'max_hr', 'vpc', 'vpc_pct', 'af_burden'],
  tmt: ['minutes', 'mets', 'peak_hr', 'st_mm', 'duke_c'],
  abpm: ['h24_s', 'h24_d', 'day_s', 'night_s', 'dip'],
  cath: ['lv_ef', 'lvedp'],
  device: ['rv_thr', 'rv_sense', 'rv_imp', 'battery_v', 'longevity', 'pct_pace_v'],
  tee: ['ef', 'laa_vel'],
};
export function compareRows(kind, cur = {}, prev = {}, curCalc = {}, prevCalc = {}) {
  const fields = allFields(kind);
  const rows = [];
  for (const k of COMPARE_KEYS[kind] || []) {
    const f = fields.find((x) => x.k === k);
    if (!f) continue;
    const a = n(cur[k] ?? curCalc[k]), b = n(prev[k] ?? prevCalc[k]);
    if (a == null && b == null) continue;
    rows.push({ k, label: f.label, unit: f.unit, now: a, before: b, diff: a != null && b != null ? r2(a - b) : null });
  }
  return rows;
}

// DAPT end date (ISO) from a cath report
export function daptEnd(report) {
  const d = report?.data;
  if (!d || !d.dapt_months || d.dapt_drug === 'Not needed') return null;
  const m = parseInt(d.dapt_months, 10);
  if (!m || !report.report_date) return null;
  const [y, mo, day] = report.report_date.split('-').map(Number);
  const x = new Date(y, mo - 1 + m, day);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

export const IMPLANT_KINDS = [['stent', 'Stent'], ['pacemaker', 'Pacemaker'], ['icd', 'ICD'], ['crt', 'CRT'], ['valve', 'Valve'], ['closure_device', 'Closure device'], ['other', 'Other / lead']];
export const implantLabel = (k) => (IMPLANT_KINDS.find((x) => x[0] === k) || [k, k])[1];
export const STENT_BRANDS = ['Xience', 'Resolute Onyx', 'Synergy', 'Orsiro', 'Promus', 'Ultimaster', 'Biomime', 'Firehawk', 'Supraflex'];
export const DEVICE_BRANDS = ['Medtronic', 'Boston Scientific', 'Abbott (St. Jude)', 'Biotronik', 'MicroPort (Sorin)', 'Vitatron'];
export const SECTION_VESSELS = VESSELS;
