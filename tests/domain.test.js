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
