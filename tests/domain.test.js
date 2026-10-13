import { describe, it, expect } from 'vitest';
import { invoiceTotals } from '../src/lib/billing.js';
import { calcBmi, addDays, waNumber } from '../src/lib/format.js';
import { urduLine, englishLine, qtyUrdu, durationUrdu, allergyHit, togglePhrase, hasPhrase, medTitle, isDosePattern, letterDraft, adviceLine, ADVICE } from '../src/lib/rx.js';

describe('prescription instruction lines', () => {
  it('turns 1+0+1 into morning and night, in English and Urdu', () => {
    const m = { form: 'Tab', name: 'Metformin 500 mg', pattern: '1+0+1', timing: 'After meal', duration: '1 month' };
    expect(englishLine(m)).toBe('1 + 0 + 1 (morning, night)  ·  After meal  ·  for 1 month');
    expect(urduLine(m)).toBe('صبح 1 گولی، رات 1 گولی - کھانے کے بعد - 1 ماہ');
    expect(medTitle(m)).toBe('Tab. Metformin 500 mg');
  });
  it('half tablets, plurals, capsules, continue', () => {
    expect(qtyUrdu('½', 'Tab')).toBe('آدھی گولی');
    expect(qtyUrdu('2', 'Tab')).toBe('2 گولیاں');
    expect(qtyUrdu('1½', 'Tab')).toBe('ڈیڑھ گولی');
    expect(qtyUrdu('1', 'Cap')).toBe('1 کیپسول');
    expect(urduLine({ form: 'Tab', pattern: '0+0+½', duration: 'Continue' })).toBe('رات آدھی گولی - مسلسل جاری رکھیں');
    expect(durationUrdu('15 days')).toBe('15 دن');
    expect(durationUrdu('2 weeks')).toBe('2 ہفتے');
  });
  it('SOS sublingual and a hand-written Urdu override', () => {
    expect(urduLine({ form: 'SL', pattern: 'SOS' })).toBe('ضرورت کے وقت 1 گولی زبان کے نیچے رکھیں');
    expect(urduLine({ form: 'Tab', pattern: '1+0+0', urdu: 'INR کے مطابق' })).toBe('INR کے مطابق');
    expect(isDosePattern('1+0+1')).toBe(true);
    expect(isDosePattern('1+1+1+1')).toBe(true);
    expect(isDosePattern('OD')).toBe(false);
  });
  it('advice lines follow the language setting', () => {
    expect(adviceLine(ADVICE[0], 'en')).toBe('Low salt diet');
    expect(adviceLine(ADVICE[0], 'both')).toBe('Low salt diet - نمک کم کھائیں');
  });
});

describe('allergy warning', () => {
  it('matches the medicine name or its drug group', () => {
    expect(allergyHit('Aspirin', 'Aspirin 75 mg')).toBe('aspirin');
    expect(allergyHit('penicillin', 'Co-amoxiclav 625 mg')).toBe('penicillin');
    expect(allergyHit('NSAIDs', 'Aspirin 75 mg')).toBe('nsaids');
    expect(allergyHit('statins, sulfa', 'Rosuvastatin 10 mg')).toBe('statins');
    expect(allergyHit('None', 'Aspirin 75 mg')).toBeNull();
    expect(allergyHit('Penicillin', 'Bisoprolol 5 mg')).toBeNull();
  });
});

describe('chips and letters', () => {
  it('toggles phrases in a comma list', () => {
    expect(togglePhrase('LVH', 'ST depression')).toBe('LVH, ST depression');
    expect(togglePhrase('LVH, ST depression', 'lvh')).toBe('ST depression');
    expect(hasPhrase('LVH, RBBB', 'RBBB')).toBe(true);
  });
  it('referral draft uses the visit findings', () => {
    const t = letterDraft('referral', { patient: { full_name: 'Ali' }, visit: { diagnosis: 'IHD', bp_systolic: 140, bp_diastolic: 90, pulse: 70, echo_ef: 35 }, rx: { medicines: [{ form: 'Tab', name: 'Aspirin 75 mg' }] } });
    expect(t).toMatch(/Kindly see Ali/);
    expect(t).toMatch(/EF 35%/);
    expect(t).toMatch(/Tab\. Aspirin 75 mg/);
  });
});

describe('billing', () => {
  it('Total 10,000 − paid 6,000 = due 4,000; another 2,000 → due 2,000', () => {
    const inv = { discount: 0, status: 'open' };
    const items = [{ quantity: 1, unit_price: 10000, status: 'active' }];
    expect(invoiceTotals(inv, items, [{ amount: 6000 }]).due).toBe(4000);
    expect(invoiceTotals(inv, items, [{ amount: 6000 }, { amount: 2000 }]).due).toBe(2000);
  });
  it('discount, cancelled lines, reversals, void', () => {
    const items = [{ quantity: 1, unit_price: 3000, status: 'active' }, { quantity: 1, unit_price: 999, status: 'cancelled' }];
    const t = invoiceTotals({ discount: 500 }, items, [{ amount: 1000 }, { amount: 1000 }, { amount: -1000 }]);
    expect(t).toEqual({ subtotal: 3000, discount: 500, total: 2500, paid: 1000, due: 1500 });
    expect(invoiceTotals({ discount: 0, status: 'void' }, items, []).due).toBe(0);
  });
});

describe('helpers', () => {
  it('BMI, follow-up dates, WhatsApp numbers', () => {
    expect(calcBmi(80, 175)).toBe(26.1);
    expect(addDays('2026-09-18', 20)).toBe('2026-10-08');
    expect(addDays('2026-09-18', 15)).toBe('2026-10-03');
    expect(waNumber('0300-1234567')).toBe('923001234567');
  });
});

// ---------------------------------------------------------------- cardiac reports
import * as S from '../src/lib/studies.js';
import { ascvd, chadsvasc, hasbled, chadsFromPatient, ageYearsOf } from '../src/lib/risk.js';

describe('echo calculations', () => {
  const ctx = { sex: 'male', age: 60 };
  const d = { height_cm: 170, weight_kg: 70, lvidd: 48, lvids: 30, ivsd: 10, lvpwd: 9, e_vel: 80, a_vel: 60, e_sep: 8, e_lat: 10, la_vol: 50, tr_vel: 2.2, ivc_d: 15, ivc_c: 'More than 50%' };
  const c = S.computeAll('echo', d, ctx);
  it('BSA, FS, LV mass, index, RWT', () => {
    expect(c.bsa).toBe(1.82);
    expect(c.fs).toBe(37.5);
    expect(c.lv_mass).toBe(159);
    expect(c.lvmi).toBe(87);
    expect(c.rwt).toBe(0.38);
  });
  it('filling pressure, LA volume index, RVSP from TR jet and IVC', () => {
    expect(c.e_ee).toBe(8.9);
    expect(c.lavi).toBe(27);
    expect(c.rap).toBe(3);
    expect(c.rvsp).toBe(22);          // 4 x 2.2^2 + 3
  });
  it('EF from volumes and aortic valve area by continuity', () => {
    expect(S.efFromVolumes(120, 50)).toBe(58);
    expect(S.avaContinuity(20, 20, 90)).toBe(0.7);
    expect(S.mvaPht(220)).toBe(1);
    expect(S.dvi(1, 4)).toBe(0.25);
  });
  it('normal range check is by sex and highlights only abnormal values', () => {
    const f = S.sectionsFor('echo').flatMap((s) => s.fields).find((x) => x.k === 'lvidd');
    expect(S.flagOf(f, 62, { sex: 'male' })).toBe('high');
    expect(S.flagOf(f, 56, { sex: 'female' })).toBe('high');
    expect(S.flagOf(f, 50, { sex: 'male' })).toBe(null);
    expect(S.flagOf(f, '', { sex: 'male' })).toBe(null);
  });
});

describe('wall motion', () => {
  it('scores WMSI and names the coronary territory', () => {
    const all = '1'.repeat(17);
    expect(S.wmsi(all)).toBe(1);
    const lad = '3' + '1'.repeat(16);         // segment 1 akinetic = anterior = LAD
    expect(S.wmsi(lad)).toBe(1.12);
    expect(S.wallMotionText(lad)).toMatch(/LAD territory/);
    expect(S.wallMotionText(all)).toMatch(/No regional/);
    expect(S.wmsi('')).toBe(null);
  });
});

describe('impression drafts', () => {
  const ctx = { sex: 'male', age: 60 };
  it('normal template gives a one-line normal echo', () => {
    expect(S.buildImpression('echo', S.normalTemplate('echo'), ctx)).toMatch(/^1\. Normal study/);
  });
  it('abnormal echo lists every important finding', () => {
    const d = { ...S.normalTemplate('echo'), ef: 35, seg: '11111111122111111', mv_reg: 'Moderate', av_st: 'Severe', av_mean: 45, effusion: 'Small', diastolic: 'Grade II (pseudonormal)' };
    const t = S.buildImpression('echo', d, ctx);
    expect(t).toMatch(/moderately reduced \(EF 35%/);
    expect(t).toMatch(/Regional wall motion abnormality/);
    expect(t).toMatch(/Moderate mitral regurgitation/);
    expect(t).toMatch(/Severe aortic stenosis/);
    expect(t).toMatch(/Small pericardial effusion/);
    expect(t).toMatch(/Grade II diastolic dysfunction/);
  });
  it('TMT: Duke score and METs', () => {
    expect(S.brucMets(9)).toBe(8.6);
    expect(S.duke(9, 0, 0)).toBe(9);
    expect(S.dukeRisk(9)).toBe('Low risk');
    expect(S.dukeRisk(-12)).toBe('High risk');
    expect(S.computeAll('tmt', { protocol: 'Bruce', minutes: 9, peak_hr: 150, st_mm: 0, angina: '0 - none' }, { age: 50 }).pct_mphr).toBe(88);
  });
  it('ABPM dipping pattern', () => {
    expect(S.dipPattern(S.dipping(140, 120))).toBe('Dipper');
    expect(S.dipPattern(S.dipping(140, 135))).toBe('Non-dipper');
    expect(S.dipPattern(S.dipping(140, 145))).toBe('Reverse dipper');
  });
  it('Holter burden and cath vessel disease', () => {
    expect(S.buildImpression('holter', { hours: 24, beats: 100000, vpc: 12000, rhythm: 'Sinus' }, {})).toMatch(/12% burden, high burden/);
    const cath = S.buildImpression('cath', { vessels: { lad: { pct: 90 }, rca: { pct: 80 }, lcx: { pct: 30 } }, complication: ['None'] }, {});
    expect(cath).toMatch(/Double vessel coronary artery disease: LAD, RCA/);
    expect(S.buildImpression('cath', { vessels: { lm: { pct: 60 } } }, {})).toMatch(/Significant left main/);
  });
  it('DAPT end date', () => {
    expect(S.daptEnd({ report_date: '2026-10-10', data: { dapt_months: '12 months', dapt_drug: 'Ticagrelor' } })).toBe('2027-10-10');
    expect(S.daptEnd({ report_date: '2026-10-10', data: { dapt_drug: 'Not needed' } })).toBe(null);
  });
  it('comparison with the previous report', () => {
    const rows = S.compareRows('echo', { ef: 40 }, { ef: 50 });
    expect(rows).toEqual([expect.objectContaining({ k: 'ef', now: 40, before: 50, diff: -10 })]);
  });
});

describe('risk calculators', () => {
  it('ASCVD matches the published worked examples', () => {
    expect(ascvd({ age: 55, sex: 'female', tc: 213, hdl: 50, sbp: 120 }).pct).toBe(2.1);
    expect(ascvd({ age: 55, sex: 'female', aa: true, tc: 213, hdl: 50, sbp: 120 }).pct).toBe(3);
    expect(Math.abs(ascvd({ age: 55, sex: 'male', tc: 213, hdl: 50, sbp: 120 }).pct - 5.3)).toBeLessThan(0.3);
    expect(ascvd({ age: 60, sex: 'male', tc: 200, hdl: 40, sbp: 150, treated: true, smoker: true, diabetes: true }).band).toBe('High');
    expect(ascvd({ age: 30, sex: 'male', tc: 200, hdl: 40, sbp: 120 })).toBe(null);      // outside 40-79
  });
  it('CHA2DS2-VASc scores and advice, age bands never double count', () => {
    expect(chadsvasc({ htn: true, age75: true }).score).toBe(3);
    expect(chadsvasc({ age75: true, age65: true }).score).toBe(2);
    expect(chadsvasc({}).advice).toMatch(/not needed/);
    expect(chadsvasc({ htn: true }).advice).toMatch(/considered/);
    expect(chadsvasc({ htn: true, dm: true }).advice).toMatch(/recommended/);
    expect(chadsvasc({ female: true, htn: true }).advice).toMatch(/considered/);    // women need 3
  });
  it('is pre-filled from the patient record', () => {
    const p = { gender: 'female', risk_factors: ['hypertension', 'diabetes'], cardiac_history: ['stroke', 'mi'] };
    const v = chadsFromPatient(p, 70, 35);
    expect(v).toMatchObject({ chf: true, htn: true, dm: true, stroke: true, vascular: true, age65: true, age75: false, female: true });
    expect(chadsvasc(v).score).toBe(8);
    expect(ageYearsOf('1960-05-01', '2026-10-10')).toBe(66);
  });
  it('HAS-BLED counts each factor once', () => {
    expect(hasbled({ htn: true, elderly: true, drugs: true }).score).toBe(3);
    expect(hasbled({ htn: true, elderly: true, drugs: true }).band).toMatch(/High/);
    expect(hasbled({}).score).toBe(0);
  });
});
