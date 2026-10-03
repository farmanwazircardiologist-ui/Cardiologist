# Heart Clinic - Cardiology Clinic Manager

A clinic system for one cardiologist (plus reception). No laboratory module.
React PWA (works offline) + Supabase (PostgreSQL, Auth, Storage, Row Level Security). Deploys GitHub → Vercel **or** Netlify → Supabase.

## What it does

- **One profile per patient**: registered once (MR number), with cardiac history, risk factors, blood thinner and INR target, allergies.
- **Profile**: cardiac summary, current medicines, trend charts (BP, pulse, weight, INR, EF) and every past visit, prescription, report, letter and bill.
- **New visit**: "Last visit" panel (previous BP and medicines, one-click *Repeat these medicines*), vitals, cardiac examination (NYHA, murmur, JVP, oedema…), ECG and Echo with one-tap chips, diagnosis.
- **Digital prescription**: 1+0+1 doses with automatic Urdu instructions (editable), templates (HTN, IHD/post-PCI, HFrEF, AF, dyslipidaemia), allergy warning, investigations advised, advice in English/Urdu, follow-up date. Saves automatically.
- **Print / PDF / WhatsApp**, made only when pressed: real letterhead (doctor's name in English and Urdu, degrees, PMDC number), A4 or A5, or "printed pad" mode that leaves your pre-printed letterhead blank.
- **Invoice only when you press "Create invoice"** (from the visit or the profile). Payments, receipts, discounts, void, reversals, automatic dues.
- **Reports & files**: photos/PDFs of outside ECG, Echo, angiography, labs, stored privately per patient.
- **Letters**: referral letter, medical, fitness and sick-leave certificates, pre-filled from the visit.
- **Today**: queue (arrived / waiting / in consultation), follow-ups to remind on WhatsApp (English + Urdu), missed follow-ups, unpaid bills.
- **Reports & backup**: daily totals, services, diagnoses, payments, dues, CSV/JSON download of all data.
- Two roles: **Doctor/Admin** (everything) and **Reception** (patients, queue, appointments, bills, report uploads; no visits or prescriptions).
- Works offline and syncs automatically; audit log; archive/anonymise retention.

## Environment variables

| Name | Where to find it |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → `anon` `public` key |

These two are the only settings. The anon key is designed to be public; all protection is done by Row Level Security.
**Never** put the `service_role` key in this app or in Vercel.

## 1. Supabase (a NEW project, separate from any other clinic)

1. Create a new project at supabase.com.
2. **SQL Editor → New query**, paste the whole of `final_supabase.sql`, press **Run**. It is the only SQL file and is safe to run again.
   It also creates the private Storage bucket `patient-files` for report photos.
3. **Authentication → Sign In / Providers → Email**: turn **off** "Allow new users to sign up".
4. **Authentication → Users → Add user → Create new user**: create the doctor's account (tick *Auto Confirm User*).
   The **first account ever created becomes the active Admin.** Later accounts are created *inactive* as Reception until the doctor ticks Active in Settings → Users.
5. **Authentication → URL Configuration**: set *Site URL* to your Vercel address (after step 3 below).
6. Optional: **Database → Extensions → pg_cron** enable, then run `final_supabase.sql` again to schedule monthly housekeeping.

## 2. GitHub

```bash
git init
git add .
git commit -m "Heart Clinic"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

`.env` is git-ignored. Only `.env.example` is committed.

## 3. Vercel

1. vercel.com → **Add New → Project** → import the repository.
2. Framework preset: **Vite** (detected automatically).
3. **Environment Variables**: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
4. **Deploy**, then put the Vercel URL into Supabase *Site URL*.

## 3b. Netlify (alternative to Vercel)

1. app.netlify.com → **Add new site → Import an existing project** → pick the GitHub repository.
2. Build command `npm run build`, publish directory `dist` (already set in `netlify.toml`).
3. **Site configuration → Environment variables**: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
4. **Deploy**, then put the Netlify URL into Supabase *Site URL*.

Use one host or the other, not both. Netlify's redirects and headers come from `netlify.toml`.

## If Settings will not save

The app now reports it when the server refuses a save ("Saved on this device but NOT on the server"). The usual cause is that the login account is not the active Admin. In Supabase run `final_supabase.sql` again (it repairs accounts created before the script was run and makes the oldest account the Admin), or check Table Editor > `profiles`: the doctor's row must have `role = admin` and `active = true`.

## First use (doctor)

A "Finish setup" box lists what is missing:

1. **Settings → Clinic & printing**: clinic name, address, phones, logo, paper size (A4/A5), English/Urdu instructions, full letterhead or printed pad (with the pad's header/footer height in mm).
2. **Settings → Doctors**: name in English and Urdu, degrees, specialty, designation, PMDC number, signature image.
3. **Settings → Services & fees**: consultation, ECG, Echo, ETT, Holter, ABPM are listed **without prices**; enter yours.
4. **Settings → Rx templates**: starter templates hold *example* doses only; review and set your own.

Open the app once on every computer/phone with internet: this registers the device for offline work.

## Local development

```bash
npm install
cp .env.example .env    # fill in the two values
npm run dev
npm test                # 53 automated tests
npm run build
```

## Notes

- PDFs are generated in the browser only when you press Print / Save PDF / WhatsApp, and are never stored.
  On phones WhatsApp receives the PDF through the share sheet; on computers the PDF downloads and the patient's WhatsApp chat opens to attach it.
- Report uploads and opening reports need internet; everything else works offline.
- Records are never hard-deleted: invoices are voided, payments reversed, patients archived.
