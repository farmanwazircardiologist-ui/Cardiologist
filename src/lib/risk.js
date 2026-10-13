// Risk calculators. Pure functions, no database. Results are saved with the
// visit (visits.risk_scores) so the profile can show them later.

const ln = Math.log;

// ---------------- ASCVD 10-year risk (Pooled Cohort Equations, 2013 ACC/AHA) --------
// "white" coefficients are used for everyone who is not African American
// (the guideline's own rule for other ethnic groups).
const PCE = {
  white_female: { age: -29.799, age2: 4.884, tc: 13.540, agetc: -3.114, hdl: -13.578, agehdl: 3.149, trSbp: 2.019, agetrSbp: 0, unSbp: 1.957, ageunSbp: 0, smoke: 7.574, agesmoke: -1.665, dm: 0.661, mean: -29.18, s10: 0.9665 },
  aa_female: { age: 17.114, age2: 0, tc: 0.940, agetc: 0, hdl: -18.920, agehdl: 4.475, trSbp: 29.291, agetrSbp: -6.432, unSbp: 27.820, ageunSbp: -6.087, smoke: 0.691, agesmoke: 0, dm: 0.874, mean: 86.61, s10: 0.9533 },
  white_male: { age: 12.344, age2: 0, tc: 11.853, agetc: -2.664, hdl: -7.990, agehdl: 1.769, trSbp: 1.797, agetrSbp: 0, unSbp: 1.764, ageunSbp: 0, smoke: 7.837, agesmoke: -1.795, dm: 0.658, mean: 61.18, s10: 0.9144 },
  aa_male: { age: 2.469, age2: 0, tc: 0.302, agetc: 0, hdl: -0.307, agehdl: 0, trSbp: 1.916, agetrSbp: 0, unSbp: 1.809, ageunSbp: 0, smoke: 0.549, agesmoke: 0, dm: 0.645, mean: 19.54, s10: 0.8954 },
};

export function ascvdValidate(i) {
  const num = (v) => (v === '' || v == null ? NaN : Number(v));
  if (!(num(i.age) >= 40 && num(i.age) <= 79)) return 'Age must be 40 to 79 years for this calculator.';
  if (!(num(i.tc) >= 130 && num(i.tc) <= 320)) return 'Total cholesterol should be 130 to 320 mg/dL.';
  if (!(num(i.hdl) >= 20 && num(i.hdl) <= 100)) return 'HDL should be 20 to 100 mg/dL.';
  if (!(num(i.sbp) >= 90 && num(i.sbp) <= 200)) return 'Systolic BP should be 90 to 200 mmHg.';
  if (i.sex !== 'male' && i.sex !== 'female') return 'Choose male or female.';
  return null;
}

// i: { age, sex, aa (bool), tc, hdl (mg/dL), sbp, treated (bool), smoker, diabetes }
export function ascvd(i) {
  if (ascvdValidate(i)) return null;
  const c = PCE[`${i.aa ? 'aa' : 'white'}_${i.sex}`];
  const a = ln(Number(i.age)), tc = ln(Number(i.tc)), hdl = ln(Number(i.hdl)), sb = ln(Number(i.sbp));
  const sm = i.smoker ? 1 : 0, dm = i.diabetes ? 1 : 0;
  const sum = c.age * a + c.age2 * a * a + c.tc * tc + c.agetc * a * tc + c.hdl * hdl + c.agehdl * a * hdl
    + (i.treated ? c.trSbp * sb + c.agetrSbp * a * sb : c.unSbp * sb + c.ageunSbp * a * sb)
    + c.smoke * sm + c.agesmoke * a * sm + c.dm * dm;
  const pct = (1 - c.s10 ** Math.exp(sum - c.mean)) * 100;
  const r = Math.round(pct * 10) / 10;
  const band = r < 5 ? 'Low' : r < 7.5 ? 'Borderline' : r < 20 ? 'Intermediate' : 'High';
  return { pct: r, band };
}

export const ASCVD_NOTE = 'Pooled Cohort Equations. They can under-estimate risk in South Asians, so family history, CKD, metabolic syndrome and a raised Lp(a) are reasons to treat as higher risk.';

// ---------------- CHA2DS2-VASc ---------------------------------------------
export const CHADS_ITEMS = [
  ['chf', 'Heart failure / LV dysfunction', 1],
  ['htn', 'Hypertension', 1],
  ['age75', 'Age 75 or more', 2],
  ['dm', 'Diabetes', 1],
  ['stroke', 'Stroke / TIA / thromboembolism', 2],
  ['vascular', 'Vascular disease (old MI, PAD, aortic plaque)', 1],
  ['age65', 'Age 65 to 74', 1],
  ['female', 'Female sex', 1],
];
export function chadsvasc(items) {
  const on = (k) => !!items[k];
  // age bands never count twice
  const set = { ...items, age65: on('age75') ? false : items.age65 };
  const score = CHADS_ITEMS.reduce((s, [k, , w]) => s + (set[k] ? w : 0), 0);
  const male = !on('female');
  // guideline: anticoagulate at 2+ in men, 3+ in women; consider at 1 (men) / 2 (women)
  const advice = (male ? score >= 2 : score >= 3) ? 'Oral anticoagulation is recommended'
    : (male ? score === 1 : score === 2) ? 'Oral anticoagulation should be considered'
      : 'Low risk: anticoagulation not needed';
  const annual = [0, 1.3, 2.2, 3.2, 4.0, 6.7, 9.8, 9.6, 6.7, 15.2][Math.min(score, 9)];
  return { score, advice, annual };
}
export function chadsFromPatient(patient, ageYears, ef) {
  const rf = patient?.risk_factors || [], h = patient?.cardiac_history || [];
  return {
    chf: h.includes('heart_failure') || (ef != null && ef < 40),
    htn: rf.includes('hypertension'), dm: rf.includes('diabetes'),
    stroke: h.includes('stroke'), vascular: h.includes('mi') || h.includes('pci') || h.includes('cabg'),
    age75: ageYears >= 75, age65: ageYears >= 65 && ageYears < 75, female: patient?.gender === 'female',
  };
}

// ---------------- HAS-BLED ---------------------------------------------------
export const HASBLED_ITEMS = [
  ['htn', 'Uncontrolled hypertension (systolic over 160)'],
  ['renal', 'Abnormal kidney function (dialysis, transplant, creatinine over 2.26 mg/dL)'],
  ['liver', 'Abnormal liver function (cirrhosis, bilirubin 2x, ALT/AST 3x)'],
  ['stroke', 'Previous stroke'],
  ['bleed', 'Bleeding history or predisposition'],
  ['inr', 'Labile INR (time in range under 60%)'],
  ['elderly', 'Age over 65'],
  ['drugs', 'Antiplatelet / NSAID use'],
  ['alcohol', 'Alcohol (8 or more drinks a week)'],
];
export function hasbled(items) {
  const score = HASBLED_ITEMS.reduce((s, [k]) => s + (items[k] ? 1 : 0), 0);
  const band = score >= 3 ? 'High bleeding risk' : score === 2 ? 'Moderate bleeding risk' : 'Low bleeding risk';
  const advice = score >= 3
    ? 'High score: correct the changeable factors and review more often. It is not a reason to stop anticoagulation by itself.'
    : 'Correct any changeable factor and review regularly.';
  return { score, band, advice };
}
export function hasbledFromPatient(patient, ageYears, visit) {
  const rf = patient?.risk_factors || [], h = patient?.cardiac_history || [];
  return {
    htn: (visit?.bp_systolic || 0) > 160, renal: rf.includes('ckd'), stroke: h.includes('stroke'),
    inr: false, elderly: ageYears > 65, drugs: false, liver: false, bleed: false, alcohol: false,
  };
}

export const ageYearsOf = (dob, at = new Date()) => {
  if (!dob) return null;
  const a = new Date(`${dob}T00:00:00`), b = new Date(at);
  let y = b.getFullYear() - a.getFullYear();
  if (b.getMonth() < a.getMonth() || (b.getMonth() === a.getMonth() && b.getDate() < a.getDate())) y -= 1;
  return y;
};
