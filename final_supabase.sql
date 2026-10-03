-- =====================================================================
--  Cardiology Clinic Manager - final_supabase.sql  (the only SQL file)
--  Run on a FRESH Supabase project: SQL Editor → New query → paste → Run.
--  Safe to run again (idempotent).
--
--  What is in here
--  * Patients (one profile per patient, with cardiac history & risk factors)
--  * Visits with vitals, cardiac examination, ECG / Echo findings, INR
--  * Digital prescriptions (medicines, Urdu instructions, investigations
--    advised, advice, follow-up) + prescription templates
--  * Appointments / today's queue / follow-ups
--  * Patient reports & files (photos/PDFs of outside ECG, Echo, labs…)
--    stored in a private Supabase Storage bucket "patient-files"
--  * Letters & certificates (referral, medical, fitness, sick leave)
--  * Billing: an invoice is created ONLY when someone presses
--    "Create invoice". Payments, reversals, void, automatic dues.
--  * Two roles: Doctor/Admin and Reception.
--  * Audit log, offline sync support, data retention.
--
--  Design notes
--  * Every synced table has: id uuid (made on the device so offline records
--    never collide), created_at, updated_at (server clock, drives sync),
--    row_version (conflict detection), created_by, updated_by.
--  * Numbers like MR1-00001, RX2-00017 carry a device code, so two devices
--    working offline can never produce the same number.
--  * PDFs are generated in the browser when needed and never stored.
--  * No lab module. Tests are only ADVISED on the prescription.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. Generic row metadata trigger (timestamps + optimistic versioning)
-- ---------------------------------------------------------------------
create or replace function public.tg_row_meta() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.created_at  := coalesce(new.created_at, now());
    new.updated_at  := now();
    new.row_version := 1;
    new.created_by  := coalesce(new.created_by, auth.uid());
    new.updated_by  := auth.uid();
  else
    new.id          := old.id;
    new.created_at  := old.created_at;
    new.created_by  := old.created_by;
    new.updated_at  := now();
    new.row_version := old.row_version + 1;
    new.updated_by  := auth.uid();
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 2. Settings, doctors, users
-- ---------------------------------------------------------------------
create table if not exists public.clinic_settings (
  id                  int primary key default 1 check (id = 1),
  clinic_name         text,
  logo                text check (logo is null or length(logo) < 400000),
  address             text,
  phone               text,
  whatsapp            text,
  email               text,
  working_hours       text,
  rx_header_note      text,
  rx_footer_note      text,
  invoice_footer_note text,
  currency            text not null default 'Rs',
  phone_country_code  text not null default '92' check (phone_country_code ~ '^[0-9]{1,4}$'),
  followup_days       int[] not null default '{7,15,30,90}',
  -- Prescription printing
  rx_print_mode       text not null default 'full' check (rx_print_mode in ('full','pad')),
  rx_paper            text not null default 'A4'   check (rx_paper in ('A4','A5')),
  rx_language         text not null default 'both' check (rx_language in ('en','ur','both')),
  rx_pad_top_mm       int  not null default 45 check (rx_pad_top_mm between 0 and 150),
  rx_pad_bottom_mm    int  not null default 20 check (rx_pad_bottom_mm between 0 and 100),
  retention_years     int not null default 5 check (retention_years between 1 and 50),
  setup_completed     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  row_version int not null default 1,
  created_by  uuid,
  updated_by  uuid
);
insert into public.clinic_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.doctors (
  id              uuid primary key default gen_random_uuid(),
  full_name       text not null check (length(trim(full_name)) > 0),
  name_urdu       text,
  qualification   text,
  designation     text,
  specialty       text,
  title_urdu      text,           -- e.g. ماہر امراض قلب
  registration_no text,           -- PMDC / PMC number
  phone           text,
  whatsapp        text,
  email           text,
  signature       text check (signature is null or length(signature) < 300000),
  active          boolean not null default true,
  sort_order      int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  row_version int not null default 1,
  created_by  uuid,
  updated_by  uuid
);

create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  full_name  text,
  role       text not null default 'reception' check (role in ('admin','reception')),
  active     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  row_version int not null default 1,
  created_by  uuid,
  updated_by  uuid
);

-- Role helpers (security definer so policies can call them without recursion)
create or replace function public.app_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.app_role() = 'admin', false)
$$;
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.app_role() in ('admin','reception'), false)
$$;

-- First account ever created becomes the active Admin (the doctor).
-- Every later account is an INACTIVE reception user until the Admin
-- activates it in Settings → Users.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare has_admin boolean;
begin
  lock table public.profiles in share row exclusive mode;
  select exists(select 1 from public.profiles where role = 'admin') into has_admin;
  insert into public.profiles (id, email, full_name, role, active)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
          case when has_admin then 'reception' else 'admin' end,
          not has_admin)
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Accounts created BEFORE this script was run have no profile yet (the trigger
-- above only sees new accounts). Give them one. If there is no active Admin,
-- the oldest account becomes the Admin, so the doctor is never locked out of
-- Settings. Safe to run again.
insert into public.profiles (id, email, full_name, role, active)
select u.id, u.email, split_part(u.email, '@', 1), 'reception', false
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id)
on conflict (id) do nothing;

update public.profiles set role = 'admin', active = true
where id = (select u.id from auth.users u join public.profiles p on p.id = u.id order by u.created_at limit 1)
  and not exists (select 1 from public.profiles where role = 'admin' and active);

-- Never allow the last active admin to be demoted/deactivated.
create or replace function public.tg_profiles_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (old.role = 'admin' and old.active) and (new.role <> 'admin' or not new.active) then
    if not exists (select 1 from public.profiles
                   where role = 'admin' and active and id <> old.id) then
      raise exception 'At least one active Admin account is required';
    end if;
  end if;
  new.id := old.id; new.email := old.email;
  return new;
end $$;

create table if not exists public.devices (
  id           uuid primary key,
  code         int generated always as identity unique,
  label        text,
  user_id      uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 3. Patients (one master profile per patient), visits, appointments
-- ---------------------------------------------------------------------
create table if not exists public.patients (
  id                 uuid primary key default gen_random_uuid(),
  mr_number          text not null unique,
  full_name          text not null check (length(trim(full_name)) > 0),
  guardian_name      text,                -- s/o, d/o, w/o
  phone              text,
  dob                date,
  dob_estimated      boolean not null default false,
  gender             text check (gender in ('male','female','other')),
  address            text,
  cnic               text,
  allergies          text,
  current_medicines  text,
  previous_diagnoses text,
  medical_history    text,
  -- Cardiac profile (entered once, updated when it changes)
  risk_factors       text[] not null default '{}',   -- hypertension, diabetes, smoker, …
  cardiac_history    text[] not null default '{}',   -- mi, pci, cabg, heart_failure, af, …
  cardiac_notes      text,                           -- e.g. "PCI to LAD 2023, DES x1"
  anticoagulant      text not null default 'none'
                     check (anticoagulant in ('none','warfarin','doac','other')),
  inr_target         text,                           -- e.g. "2.0 – 3.0"
  archived_at        timestamptz,
  anonymized_at      timestamptz,
  deleted_at         timestamptz,
  delete_reason      text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  row_version int not null default 1,
  created_by  uuid,
  updated_by  uuid
);
create index if not exists patients_name_idx  on public.patients (lower(full_name));
create index if not exists patients_phone_idx on public.patients (phone);
create index if not exists patients_upd_idx   on public.patients (updated_at);

create table if not exists public.visits (
  id                uuid primary key default gen_random_uuid(),
  visit_number      text not null unique,
  patient_id        uuid not null references public.patients(id),
  doctor_id         uuid not null references public.doctors(id),
  visit_date        date not null default current_date,
  status            text not null default 'open' check (status in ('open','completed','cancelled')),
  cancel_reason     text,
  chief_complaint   text,
  history           text,
  -- Vitals
  bp_systolic       int check (bp_systolic between 30 and 300),
  bp_diastolic      int check (bp_diastolic between 10 and 250),
  pulse             int check (pulse between 10 and 300),
  temperature       numeric(4,1) check (temperature between 80 and 115),  -- Fahrenheit
  resp_rate         int check (resp_rate between 4 and 80),
  weight_kg         numeric(5,1) check (weight_kg between 0.3 and 400),
  height_cm         numeric(5,1) check (height_cm between 20 and 260),
  spo2              int check (spo2 between 30 and 100),
  bmi               numeric(4,1),
  blood_sugar       int check (blood_sugar between 10 and 1500),           -- random BSR mg/dL
  inr               numeric(3,1) check (inr between 0.5 and 15),
  -- Cardiac examination
  chest_pain        text,     -- None / Typical angina / Atypical / Non-cardiac
  nyha_class        text check (nyha_class in ('I','II','III','IV')),
  rhythm            text,     -- Regular / Irregular
  heart_sounds      text,     -- S1 S2 normal / S3 / …
  murmur            text,
  jvp               text,
  edema             text,
  chest_exam        text,     -- lungs: clear / basal crackles …
  examination       text,     -- any other findings
  -- ECG / Echo (done here or seen from outside reports)
  ecg_rhythm        text,
  ecg_rate          int check (ecg_rate between 10 and 300),
  ecg_findings      text,
  echo_ef           int check (echo_ef between 5 and 90),
  echo_findings     text,
  diagnosis         text,
  notes             text,
  deleted_at        timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  row_version int not null default 1,
  created_by  uuid,
  updated_by  uuid
);
-- ONE consultation = ONE visit: a patient has at most one active visit per
-- doctor per date. Starting it again the same day re-opens the same visit.
create unique index if not exists visits_one_per_day
  on public.visits (patient_id, doctor_id, visit_date)
  where deleted_at is null and status <> 'cancelled';
create index if not exists visits_patient_idx on public.visits (patient_id);
create index if not exists visits_date_idx    on public.visits (visit_date);
create index if not exists visits_upd_idx     on public.visits (updated_at);

create or replace function public.tg_visit_bmi() returns trigger
language plpgsql as $$
begin
  if new.weight_kg is not null and new.height_cm is not null and new.height_cm > 0 then
    new.bmi := round(new.weight_kg / ((new.height_cm/100.0)^2), 1);
  else
    new.bmi := null;
  end if;
  return new;
end $$;

create table if not exists public.appointments (
  id              uuid primary key default gen_random_uuid(),
  appt_number     text not null unique,
  patient_id      uuid not null references public.patients(id),
  doctor_id       uuid references public.doctors(id),
  appt_date       date not null,
  appt_time       time,
  kind            text not null default 'new' check (kind in ('new','follow_up')),
  status          text not null default 'scheduled'
                  check (status in ('scheduled','confirmed','waiting','in_consultation','completed','cancelled')),
  cancel_reason   text,
  source_visit_id uuid references public.visits(id),   -- visit that booked this follow-up
  visit_id        uuid references public.visits(id),   -- visit started when the patient arrived
  notes           text,
  reminded_at     timestamptz,                         -- last WhatsApp reminder
  deleted_at      timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  row_version int not null default 1,
  created_by  uuid,
  updated_by  uuid
);
create unique index if not exists appointments_no_double_booking
  on public.appointments (doctor_id, appt_date, appt_time)
  where appt_time is not null and status <> 'cancelled' and deleted_at is null;
create index if not exists appointments_date_idx    on public.appointments (appt_date);
create index if not exists appointments_patient_idx on public.appointments (patient_id);
create index if not exists appointments_upd_idx     on public.appointments (updated_at);

-- ---------------------------------------------------------------------
-- 4. Medicines, prescriptions, templates, services
-- ---------------------------------------------------------------------
create table if not exists public.medicines (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,             -- "Amlodipine 5 mg"
  form             text,                      -- Tab / Cap / Syp / Inj / Inhaler / SL / Sachet / Drops
  default_pattern  text,                      -- "1+0+1"
  default_timing   text,                      -- After meal …
  default_duration text,                      -- 1 month …
  active           boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  row_version int not null default 1,
  created_by  uuid,
  updated_by  uuid
);
create unique index if not exists medicines_name_uq on public.medicines (lower(name));

-- medicines jsonb: [{form, name, pattern, timing, duration, note, urdu}]
create table if not exists public.prescriptions (
  id              uuid primary key default gen_random_uuid(),
  rx_number       text not null unique,
  visit_id        uuid not null references public.visits(id),
  patient_id      uuid not null references public.patients(id),
  doctor_id       uuid not null references public.doctors(id),
  diagnosis       text,
  medicines       jsonb not null default '[]'::jsonb check (jsonb_typeof(medicines) = 'array'),
  investigations  text[] not null default '{}',
  advice          text,
  follow_up_date  date,
  copied_from_id  uuid references public.prescriptions(id),
  template_id     uuid,
  deleted_at      timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  row_version int not null default 1,
  created_by  uuid,
  updated_by  uuid
);
create unique index if not exists prescriptions_one_per_visit
  on public.prescriptions (visit_id) where deleted_at is null;
create index if not exists prescriptions_patient_idx on public.prescriptions (patient_id);
create index if not exists prescriptions_upd_idx     on public.prescriptions (updated_at);

create table if not exists public.rx_templates (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  diagnosis      text,
  medicines      jsonb not null default '[]'::jsonb check (jsonb_typeof(medicines) = 'array'),
  investigations text[] not null default '{}',
  advice         text,
  active         boolean not null default true,
  is_starter     boolean not null default false,
  sort_order     int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  row_version int not null default 1,
  created_by  uuid,
  updated_by  uuid
);
create unique index if not exists rx_templates_name_uq on public.rx_templates (lower(name));

create table if not exists public.clinic_services (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  price      numeric(12,2) check (price is null or price >= 0),   -- entered by Admin
  auto_add   boolean not null default false,  -- pre-ticked when an invoice is created for a visit
  active     boolean not null default true,
  sort_order int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  row_version int not null default 1,
  created_by  uuid,
  updated_by  uuid
);
create unique index if not exists clinic_services_name_uq on public.clinic_services (lower(name));

-- ---------------------------------------------------------------------
-- 5. Patient reports & files, letters & certificates
-- ---------------------------------------------------------------------
-- The file itself lives in Storage bucket "patient-files" (private).
create table if not exists public.patient_files (
  id           uuid primary key default gen_random_uuid(),
  patient_id   uuid not null references public.patients(id),
  visit_id     uuid references public.visits(id),
  category     text not null default 'other'
               check (category in ('ecg','echo','angiography','ett','holter','lab','xray','discharge','prescription','other')),
  title        text,
  file_date    date not null default current_date,
  storage_path text not null unique,
  mime_type    text not null,
  size_bytes   int check (size_bytes between 1 and 15728640),
  deleted_at   timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  row_version int not null default 1,
  created_by  uuid,
  updated_by  uuid
);
create index if not exists patient_files_patient_idx on public.patient_files (patient_id);
create index if not exists patient_files_upd_idx     on public.patient_files (updated_at);

create table if not exists public.letters (
  id            uuid primary key default gen_random_uuid(),
  letter_number text not null unique,
  patient_id    uuid not null references public.patients(id),
  visit_id      uuid references public.visits(id),
  doctor_id     uuid not null references public.doctors(id),
  kind          text not null check (kind in ('referral','medical','fitness','sick_leave')),
  letter_date   date not null default current_date,
  addressed_to  text,          -- referral: "Dr. … / Hospital"; certificate: "To whom it may concern"
  diagnosis     text,
  body          text,
  from_date     date,
  to_date       date,
  deleted_at    timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  row_version int not null default 1,
  created_by  uuid,
  updated_by  uuid,
  check (to_date is null or from_date is null or to_date >= from_date)
);
create index if not exists letters_patient_idx on public.letters (patient_id);
create index if not exists letters_upd_idx     on public.letters (updated_at);

-- ---------------------------------------------------------------------
-- 6. Billing (an invoice is created only on request)
-- ---------------------------------------------------------------------
create table if not exists public.invoices (
  id             uuid primary key default gen_random_uuid(),
  invoice_number text not null unique,
  patient_id     uuid not null references public.patients(id),
  visit_id       uuid references public.visits(id),
  invoice_date   date not null default current_date,
  discount       numeric(12,2) not null default 0 check (discount >= 0),
  status         text not null default 'open' check (status in ('open','void')),
  void_reason    text,
  voided_by      uuid,
  voided_at      timestamptz,
  notes          text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  row_version int not null default 1,
  created_by  uuid,
  updated_by  uuid,
  check (status <> 'void' or void_reason is not null)
);
create unique index if not exists invoices_one_per_visit
  on public.invoices (visit_id) where visit_id is not null and status <> 'void';
create index if not exists invoices_patient_idx on public.invoices (patient_id);
create index if not exists invoices_date_idx    on public.invoices (invoice_date);
create index if not exists invoices_upd_idx     on public.invoices (updated_at);

create table if not exists public.invoice_items (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references public.invoices(id),
  description text not null,
  service_id  uuid references public.clinic_services(id),
  quantity    numeric(10,2) not null default 1 check (quantity > 0),
  unit_price  numeric(12,2) not null default 0 check (unit_price >= 0),
  status      text not null default 'active' check (status in ('active','cancelled')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  row_version int not null default 1,
  created_by  uuid,
  updated_by  uuid
);
create index if not exists invoice_items_invoice_idx on public.invoice_items (invoice_id);
create index if not exists invoice_items_upd_idx     on public.invoice_items (updated_at);

create table if not exists public.payments (
  id                  uuid primary key default gen_random_uuid(),
  payment_number      text not null unique,
  invoice_id          uuid not null references public.invoices(id),
  patient_id          uuid not null references public.patients(id),
  amount              numeric(12,2) not null check (amount <> 0),
  method              text not null check (method in ('cash','card','bank_transfer','jazzcash','easypaisa','other')),
  reference           text,
  kind                text not null default 'payment' check (kind in ('payment','reversal')),
  reverses_payment_id uuid unique references public.payments(id),
  reason              text,
  received_at         timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  row_version int not null default 1,
  created_by  uuid,
  updated_by  uuid,
  check ((kind = 'payment'  and amount > 0 and reverses_payment_id is null)
      or (kind = 'reversal' and amount < 0 and reverses_payment_id is not null
          and reason is not null and length(trim(reason)) > 0))
);
create index if not exists payments_invoice_idx  on public.payments (invoice_id);
create index if not exists payments_patient_idx  on public.payments (patient_id);
create index if not exists payments_received_idx on public.payments (received_at);
create index if not exists payments_upd_idx      on public.payments (updated_at);

-- Totals are always calculated, never typed.
create or replace view public.invoice_summary with (security_invoker = true) as
select i.id, i.invoice_number, i.patient_id, i.visit_id, i.invoice_date, i.status,
       coalesce(it.subtotal, 0)                                             as subtotal,
       least(i.discount, coalesce(it.subtotal, 0))                          as discount,
       greatest(coalesce(it.subtotal, 0) - i.discount, 0)                   as total,
       coalesce(p.paid, 0)                                                  as paid,
       case when i.status = 'void' then 0
            else greatest(coalesce(it.subtotal, 0) - i.discount, 0) - coalesce(p.paid, 0) end as due
from public.invoices i
left join (select invoice_id, sum(quantity * unit_price) subtotal
           from public.invoice_items where status = 'active' group by invoice_id) it on it.invoice_id = i.id
left join (select invoice_id, sum(amount) paid from public.payments group by invoice_id) p on p.invoice_id = i.id;

-- ---------------------------------------------------------------------
-- 7. Audit log + sync conflicts
-- ---------------------------------------------------------------------
create table if not exists public.audit_log (
  id         bigint generated always as identity primary key,
  table_name text not null,
  record_id  text,
  action     text not null,
  changes    jsonb,
  user_id    uuid,
  at         timestamptz not null default now()
);
create index if not exists audit_log_record_idx on public.audit_log (table_name, record_id);
create index if not exists audit_log_at_idx     on public.audit_log (at);

create table if not exists public.sync_conflicts (
  id          uuid primary key default gen_random_uuid(),
  table_name  text not null,
  record_id   uuid,
  local_data  jsonb,
  server_data jsonb,
  error       text,
  device_code int,
  user_id     uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid,
  resolution  text
);
create index if not exists sync_conflicts_open_idx on public.sync_conflicts (resolved_at);

create or replace function public.tg_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o jsonb; n jsonb; diff jsonb := '{}'::jsonb; k text;
  skip text[] := array['updated_at','row_version','updated_by','created_at','created_by'];
begin
  if tg_op = 'INSERT' then
    n := to_jsonb(new) - skip;
    -- keep images out of the audit trail (size)
    n := n - 'logo' - 'signature';
    insert into public.audit_log (table_name, record_id, action, changes, user_id)
    values (tg_table_name, (to_jsonb(new)->>'id'), 'insert', n, auth.uid());
    return new;
  elsif tg_op = 'UPDATE' then
    o := to_jsonb(old); n := to_jsonb(new);
    for k in select jsonb_object_keys(n) loop
      if k = any(skip) then continue; end if;
      if (o->k) is distinct from (n->k) then
        if k in ('logo','signature') then
          diff := diff || jsonb_build_object(k, jsonb_build_object('old','[image]','new','[image]'));
        else
          diff := diff || jsonb_build_object(k, jsonb_build_object('old', o->k, 'new', n->k));
        end if;
      end if;
    end loop;
    if diff <> '{}'::jsonb then
      insert into public.audit_log (table_name, record_id, action, changes, user_id)
      values (tg_table_name, (n->>'id'), 'update', diff, auth.uid());
    end if;
    return new;
  else
    insert into public.audit_log (table_name, record_id, action, changes, user_id)
    values (tg_table_name, (to_jsonb(old)->>'id'), 'delete', to_jsonb(old) - 'logo' - 'signature', auth.uid());
    return old;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 8. Integrity / business-rule triggers
-- ---------------------------------------------------------------------
-- A record that points at a visit must belong to that visit's patient.
create or replace function public.tg_visit_patient_match() returns trigger
language plpgsql security definer set search_path = public as $$
declare vp uuid;
begin
  if new.visit_id is not null then
    select patient_id into vp from public.visits where id = new.visit_id;
    if vp is not null and vp <> new.patient_id then
      raise exception 'Record belongs to a different patient than its visit';
    end if;
  end if;
  return new;
end $$;

create or replace function public.tg_block_delete() returns trigger
language plpgsql as $$
begin
  raise exception '% records cannot be deleted. Use cancel/void/reversal instead.', tg_table_name;
end $$;

-- Reception can bill only listed services, always at the price set by the
-- doctor in Settings. Only the Admin can change a line's price.
create or replace function public.tg_invoice_item_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare p numeric; nm text;
begin
  if public.app_role() = 'reception' then
    if tg_op = 'UPDATE' then
      new.unit_price  := old.unit_price;
      new.quantity    := old.quantity;
      new.service_id  := old.service_id;
      new.description := old.description;
      return new;
    end if;
    if new.service_id is null then
      raise exception 'Reception can only bill services listed in Settings';
    end if;
    select price, name into p, nm from public.clinic_services where id = new.service_id;
    if p is null then
      raise exception 'This service has no price yet. Ask the doctor to set it in Settings.';
    end if;
    new.unit_price  := p;
    new.description := nm;
  end if;
  return new;
end $$;

create or replace function public.tg_invoice_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare net numeric;
begin
  if tg_op = 'INSERT' then
    if coalesce(new.discount, 0) <> 0 and public.app_role() is distinct from 'admin' then
      raise exception 'Only the doctor/admin can give a discount';
    end if;
    return new;
  end if;
  new.patient_id := old.patient_id;
  if old.status = 'void' and new.status <> 'void' then
    raise exception 'A void invoice cannot be re-opened';
  end if;
  if new.discount is distinct from old.discount and public.app_role() is distinct from 'admin' then
    raise exception 'Only the doctor/admin can give a discount';
  end if;
  if new.status = 'void' and old.status <> 'void' then
    if public.app_role() is distinct from 'admin' then
      raise exception 'Only Admin can void an invoice';
    end if;
    select coalesce(sum(amount),0) into net from public.payments where invoice_id = new.id;
    if net > 0 then
      raise exception 'Reverse the payments on this invoice before voiding it';
    end if;
    new.voided_at := coalesce(new.voided_at, now());
    new.voided_by := coalesce(new.voided_by, auth.uid());
  end if;
  return new;
end $$;

create or replace function public.tg_payment_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare inv record; orig record; v_total numeric; v_paid numeric;
begin
  if tg_op = 'UPDATE' then
    raise exception 'Payments cannot be edited. Record a reversal instead.';
  end if;
  select * into inv from public.invoices where id = new.invoice_id;
  if inv.status = 'void' then raise exception 'Cannot record a payment on a void invoice'; end if;
  new.patient_id := inv.patient_id;
  if new.kind = 'reversal' then
    if public.app_role() is distinct from 'admin' then
      raise exception 'Only Admin can reverse a payment';
    end if;
    select * into orig from public.payments where id = new.reverses_payment_id;
    if orig.id is null or orig.kind <> 'payment' or orig.invoice_id <> new.invoice_id then
      raise exception 'Reversal must reference an original payment on the same invoice';
    end if;
    new.amount := -orig.amount;
    new.method := orig.method;
  else
    select s.total, s.paid into v_total, v_paid from public.invoice_summary s where s.id = new.invoice_id;
    if coalesce(v_paid,0) + new.amount > coalesce(v_total,0) + 0.001 then
      raise exception 'Payment is more than the amount due';
    end if;
  end if;
  return new;
end $$;

-- A returning archived patient becomes active again automatically.
create or replace function public.tg_unarchive_patient() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.patients set archived_at = null
   where id = new.patient_id and archived_at is not null;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 9. Attach triggers
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['clinic_settings','doctors','profiles','patients','visits','appointments',
    'medicines','prescriptions','rx_templates','clinic_services','patient_files','letters',
    'invoices','invoice_items','payments']
  loop
    execute format('drop trigger if exists a_row_meta on public.%I', t);
    execute format('create trigger a_row_meta before insert or update on public.%I
                    for each row execute function public.tg_row_meta()', t);
  end loop;

  foreach t in array array['clinic_settings','doctors','profiles','patients','prescriptions',
    'rx_templates','clinic_services','patient_files','letters','invoices','invoice_items','payments']
  loop
    execute format('drop trigger if exists z_audit on public.%I', t);
    execute format('create trigger z_audit after insert or update or delete on public.%I
                    for each row execute function public.tg_audit()', t);
  end loop;

  foreach t in array array['patients','visits','appointments','prescriptions','patient_files',
    'letters','invoices','invoice_items','payments']
  loop
    execute format('drop trigger if exists no_delete on public.%I', t);
    execute format('create trigger no_delete before delete on public.%I
                    for each row execute function public.tg_block_delete()', t);
  end loop;

  foreach t in array array['prescriptions','invoices','patient_files','letters']
  loop
    execute format('drop trigger if exists b_visit_patient on public.%I', t);
    execute format('create trigger b_visit_patient before insert or update on public.%I
                    for each row execute function public.tg_visit_patient_match()', t);
  end loop;

  foreach t in array array['visits','appointments']
  loop
    execute format('drop trigger if exists c_unarchive on public.%I', t);
    execute format('create trigger c_unarchive after insert on public.%I
                    for each row execute function public.tg_unarchive_patient()', t);
  end loop;
end $$;

drop trigger if exists b_profiles_guard on public.profiles;
create trigger b_profiles_guard before update on public.profiles
  for each row execute function public.tg_profiles_guard();
drop trigger if exists b_visit_bmi on public.visits;
create trigger b_visit_bmi before insert or update on public.visits
  for each row execute function public.tg_visit_bmi();
drop trigger if exists b_invoice_item_guard on public.invoice_items;
create trigger b_invoice_item_guard before insert or update on public.invoice_items
  for each row execute function public.tg_invoice_item_guard();
drop trigger if exists b_invoice_guard on public.invoices;
create trigger b_invoice_guard before insert or update on public.invoices
  for each row execute function public.tg_invoice_guard();
drop trigger if exists b_payment_guard on public.payments;
create trigger b_payment_guard before insert or update on public.payments
  for each row execute function public.tg_payment_guard();

-- ---------------------------------------------------------------------
-- 10. RPC functions used by the app
-- ---------------------------------------------------------------------
-- Registers this browser/device and returns its short code used in numbers.
create or replace function public.register_device(p_id uuid, p_label text)
returns int language plpgsql security definer set search_path = public as $$
declare c int;
begin
  if not public.is_staff() then raise exception 'Not authorised'; end if;
  insert into public.devices (id, label, user_id) values (p_id, p_label, auth.uid())
  on conflict (id) do update set last_seen_at = now(), user_id = auth.uid()
  returning code into c;
  return c;
end $$;

-- Highest sequence already used by a device for each document type, so a
-- device whose local storage was cleared continues numbering safely.
create or replace function public.device_max_numbers(p_code int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb := '{}'::jsonb; v int;
begin
  if not public.is_staff() then raise exception 'Not authorised'; end if;
  select max(split_part(mr_number,'-',2)::int) into v from public.patients where mr_number like 'MR'||p_code||'-%';
  r := r || jsonb_build_object('MR', coalesce(v,0));
  select max(split_part(visit_number,'-',2)::int) into v from public.visits where visit_number like 'V'||p_code||'-%';
  r := r || jsonb_build_object('V', coalesce(v,0));
  select max(split_part(appt_number,'-',2)::int) into v from public.appointments where appt_number like 'AP'||p_code||'-%';
  r := r || jsonb_build_object('AP', coalesce(v,0));
  select max(split_part(rx_number,'-',2)::int) into v from public.prescriptions where rx_number like 'RX'||p_code||'-%';
  r := r || jsonb_build_object('RX', coalesce(v,0));
  select max(split_part(letter_number,'-',2)::int) into v from public.letters where letter_number like 'DOC'||p_code||'-%';
  r := r || jsonb_build_object('DOC', coalesce(v,0));
  select max(split_part(invoice_number,'-',2)::int) into v from public.invoices where invoice_number like 'INV'||p_code||'-%';
  r := r || jsonb_build_object('INV', coalesce(v,0));
  select max(split_part(payment_number,'-',2)::int) into v from public.payments where payment_number like 'PAY'||p_code||'-%';
  r := r || jsonb_build_object('PAY', coalesce(v,0));
  return r;
end $$;

-- ---------------------------------------------------------------------
-- 11. Data retention: archive → (optional) anonymize. Never hard delete.
-- ---------------------------------------------------------------------
create or replace function public.retention_candidates()
returns table (patient_id uuid, mr_number text, full_name text, last_activity timestamptz, archived boolean)
language plpgsql stable security definer set search_path = public as $$
declare yrs int;
begin
  if auth.uid() is not null and not public.is_admin() then raise exception 'Not authorised'; end if;
  select retention_years into yrs from public.clinic_settings where id = 1;
  return query
  with act as (
    select p.id, p.mr_number, p.full_name, p.archived_at,
      greatest(p.created_at,
        (select max(v.visit_date)::timestamptz  from public.visits v        where v.patient_id = p.id),
        (select max(a.appt_date)::timestamptz   from public.appointments a  where a.patient_id = p.id),
        (select max(pm.received_at)             from public.payments pm     where pm.patient_id = p.id)) as last_act
    from public.patients p
    where p.deleted_at is null and p.anonymized_at is null
  )
  select a.id, a.mr_number, a.full_name, a.last_act, a.archived_at is not null
  from act a
  where a.last_act < now() - make_interval(years => yrs)
    and not exists (select 1 from public.visits v where v.patient_id = a.id and v.status = 'open' and v.deleted_at is null)
    and not exists (select 1 from public.appointments ap where ap.patient_id = a.id and ap.deleted_at is null
                    and ap.status not in ('completed','cancelled') and ap.appt_date >= current_date)
    and not exists (select 1 from public.invoice_summary s where s.patient_id = a.id and s.due > 0);
end $$;

create or replace function public.retention_archive()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is not null and not public.is_admin() then raise exception 'Not authorised'; end if;
  update public.patients p set archived_at = now()
   where p.archived_at is null
     and p.id in (select patient_id from public.retention_candidates());
  get diagnostics n = row_count;
  return n;
end $$;

-- Removes personal identifiers from archived, inactive patients while keeping
-- financial totals and all foreign keys valid.
create or replace function public.retention_anonymize(p_patient_ids uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is not null and not public.is_admin() then raise exception 'Not authorised'; end if;
  with ok as (
    select c.patient_id from public.retention_candidates() c
    where c.archived and c.patient_id = any(p_patient_ids)
  )
  update public.patients p set
      full_name = 'Anonymized patient', guardian_name = null, phone = null, address = null, cnic = null,
      dob = case when p.dob is null then null else make_date(extract(year from p.dob)::int, 1, 1) end,
      dob_estimated = true, allergies = null, current_medicines = null,
      previous_diagnoses = null, medical_history = null, cardiac_notes = null, anonymized_at = now()
  from ok where p.id = ok.patient_id;
  get diagnostics n = row_count;

  update public.visits v set chief_complaint = null, history = null, examination = null, notes = null
   where v.patient_id = any(p_patient_ids)
     and exists (select 1 from public.patients p where p.id = v.patient_id and p.anonymized_at is not null);
  update public.prescriptions r set advice = null
   where r.patient_id = any(p_patient_ids)
     and exists (select 1 from public.patients p where p.id = r.patient_id and p.anonymized_at is not null);
  update public.letters l set body = null, addressed_to = null
   where l.patient_id = any(p_patient_ids)
     and exists (select 1 from public.patients p where p.id = l.patient_id and p.anonymized_at is not null);
  return n;
end $$;

-- Housekeeping of purely technical data (keeps the database light).
create or replace function public.retention_housekeeping()
returns void language plpgsql security definer set search_path = public as $$
declare yrs int;
begin
  if auth.uid() is not null and not public.is_admin() then raise exception 'Not authorised'; end if;
  select retention_years into yrs from public.clinic_settings where id = 1;
  delete from public.sync_conflicts where resolved_at < now() - interval '90 days';
  delete from public.audit_log
   where at < now() - make_interval(years => yrs)
     and table_name not in ('invoices','invoice_items','payments','prescriptions','clinic_settings');
  delete from public.devices where last_seen_at < now() - make_interval(years => yrs);
end $$;

-- Monthly schedule when pg_cron is available (Database → Extensions → pg_cron).
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron not available; run retention from Settings → Data retention';
  end;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.unschedule('clinic-retention');
    exception when others then null;
    end;
    perform cron.schedule('clinic-retention', '0 2 1 * *',
      'select public.retention_archive(); select public.retention_housekeeping();');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 12. Privileges + Row Level Security
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon;
grant usage on schema public to authenticated;
grant select, insert, update on all tables in schema public to authenticated;
revoke insert, update on public.audit_log, public.devices from authenticated;
grant select on public.invoice_summary to authenticated;
revoke execute on all functions in schema public from anon, public;
grant execute on function public.app_role(), public.is_admin(), public.is_staff(),
  public.register_device(uuid, text), public.device_max_numbers(int),
  public.retention_candidates(), public.retention_archive(), public.retention_anonymize(uuid[]),
  public.retention_housekeeping() to authenticated;

do $$
declare t text;
begin
  foreach t in array array['clinic_settings','doctors','profiles','devices','patients','visits',
    'appointments','medicines','prescriptions','rx_templates','clinic_services','patient_files',
    'letters','invoices','invoice_items','payments','audit_log','sync_conflicts']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- helper: recreate a policy idempotently
create or replace function public._pol(p_table text, p_name text, p_cmd text, p_using text, p_check text)
returns void language plpgsql as $$
begin
  execute format('drop policy if exists %I on public.%I', p_name, p_table);
  execute format('create policy %I on public.%I for %s to authenticated %s %s',
    p_name, p_table, p_cmd,
    case when p_using is null then '' else 'using (' || p_using || ')' end,
    case when p_check is null then '' else 'with check (' || p_check || ')' end);
end $$;

-- settings / doctors / services: everyone signed in reads, only Admin writes
select public._pol('clinic_settings','read','select','public.is_staff()',null);
select public._pol('clinic_settings','admin_update','update','public.is_admin()','public.is_admin()');
select public._pol('doctors','read','select','public.is_staff()',null);
select public._pol('doctors','admin_insert','insert',null,'public.is_admin()');
select public._pol('doctors','admin_update','update','public.is_admin()','public.is_admin()');
select public._pol('clinic_services','read','select','public.is_staff()',null);
select public._pol('clinic_services','admin_insert','insert',null,'public.is_admin()');
select public._pol('clinic_services','admin_update','update','public.is_admin()','public.is_admin()');

-- profiles: see yourself; Admin sees and manages everyone
select public._pol('profiles','read','select','id = auth.uid() or public.is_admin()',null);
select public._pol('profiles','admin_update','update','public.is_admin()','public.is_admin()');

select public._pol('devices','read','select','public.is_staff()',null);

-- patients, appointments, reports/files: doctor and reception
select public._pol('patients','read','select','public.is_staff()',null);
select public._pol('patients','insert','insert',null,'public.is_staff()');
select public._pol('patients','update','update','public.is_staff()','public.is_staff()');
select public._pol('appointments','staff_s','select','public.is_staff()',null);
select public._pol('appointments','staff_i','insert',null,'public.is_staff()');
select public._pol('appointments','staff_u','update','public.is_staff()','public.is_staff()');
select public._pol('patient_files','staff_s','select','public.is_staff()',null);
select public._pol('patient_files','staff_i','insert',null,'public.is_staff()');
select public._pol('patient_files','admin_u','update','public.is_admin()','public.is_admin()');

-- clinical records: Doctor/Admin only
select public._pol('visits','admin_s','select','public.is_admin()',null);
select public._pol('visits','admin_i','insert',null,'public.is_admin()');
select public._pol('visits','admin_u','update','public.is_admin()','public.is_admin()');
select public._pol('prescriptions','admin_s','select','public.is_admin()',null);
select public._pol('prescriptions','admin_i','insert',null,'public.is_admin()');
select public._pol('prescriptions','admin_u','update','public.is_admin()','public.is_admin()');
select public._pol('rx_templates','admin_s','select','public.is_admin()',null);
select public._pol('rx_templates','admin_i','insert',null,'public.is_admin()');
select public._pol('rx_templates','admin_u','update','public.is_admin()','public.is_admin()');
select public._pol('medicines','admin_s','select','public.is_admin()',null);
select public._pol('medicines','admin_i','insert',null,'public.is_admin()');
select public._pol('medicines','admin_u','update','public.is_admin()','public.is_admin()');
select public._pol('letters','admin_s','select','public.is_admin()',null);
select public._pol('letters','admin_i','insert',null,'public.is_admin()');
select public._pol('letters','admin_u','update','public.is_admin()','public.is_admin()');

-- billing: doctor and reception (price, discount, void and reversal rules
-- are enforced by the triggers above)
select public._pol('invoices','s','select','public.is_staff()',null);
select public._pol('invoices','i','insert',null,'public.is_staff()');
select public._pol('invoices','u','update','public.is_staff()','public.is_staff()');
select public._pol('invoice_items','s','select','public.is_staff()',null);
select public._pol('invoice_items','i','insert',null,'public.is_staff()');
select public._pol('invoice_items','u','update','public.is_staff()','public.is_staff()');
select public._pol('payments','s','select','public.is_staff()',null);
select public._pol('payments','i','insert',null,'public.is_staff()');
-- (no update/delete policies on payments: reversals only)

select public._pol('audit_log','admin_read','select','public.is_admin()',null);
select public._pol('sync_conflicts','s','select','public.is_admin() or user_id = auth.uid()',null);
select public._pol('sync_conflicts','i','insert',null,'public.is_staff() and user_id = auth.uid()');
select public._pol('sync_conflicts','u','update','public.is_admin()','public.is_admin()');

-- ---------------------------------------------------------------------
-- 13. Storage bucket for patient reports (private; staff only)
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public)
    values ('patient-files', 'patient-files', false)
    on conflict (id) do nothing;
    begin
      execute 'update storage.buckets
                  set file_size_limit = 15728640,
                      allowed_mime_types = array[''image/jpeg'',''image/png'',''image/webp'',''application/pdf'']
                where id = ''patient-files''';
    exception when undefined_column then null;   -- older storage versions
    end;

    execute 'drop policy if exists "patient files read" on storage.objects';
    execute 'create policy "patient files read" on storage.objects for select to authenticated
             using (bucket_id = ''patient-files'' and public.is_staff())';
    execute 'drop policy if exists "patient files upload" on storage.objects';
    execute 'create policy "patient files upload" on storage.objects for insert to authenticated
             with check (bucket_id = ''patient-files'' and public.is_staff())';
    -- No update/delete policy: uploaded reports are never overwritten or removed.
  else
    raise notice 'Storage schema not found: report uploads will not work until Storage is enabled and this file is run again.';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 14. Reference data (no patients, no transactions, no prices)
-- ---------------------------------------------------------------------
insert into public.clinic_services (name, price, auto_add, sort_order) values
 ('Consultation', null, true, 1),
 ('Follow-up consultation', null, false, 2),
 ('ECG', null, false, 3),
 ('Echocardiography', null, false, 4),
 ('ETT (Exercise tolerance test)', null, false, 5),
 ('Holter monitoring (24 h)', null, false, 6),
 ('ABPM (24 h BP monitoring)', null, false, 7)
on conflict do nothing;

-- Cardiac medicine names for autocomplete (generic names). New names typed in
-- prescriptions are added automatically. Defaults are only suggestions.
insert into public.medicines (name, form, default_pattern, default_timing, default_duration) values
 ('Aspirin 75 mg','Tab','0+1+0','After meal','Continue'),
 ('Aspirin 150 mg','Tab','0+1+0','After meal','Continue'),
 ('Clopidogrel 75 mg','Tab','0+1+0','After meal','Continue'),
 ('Ticagrelor 90 mg','Tab','1+0+1','After meal','Continue'),
 ('Prasugrel 10 mg','Tab','1+0+0','After meal','Continue'),
 ('Atorvastatin 20 mg','Tab','0+0+1','','Continue'),
 ('Atorvastatin 40 mg','Tab','0+0+1','','Continue'),
 ('Atorvastatin 80 mg','Tab','0+0+1','','Continue'),
 ('Rosuvastatin 10 mg','Tab','0+0+1','','Continue'),
 ('Rosuvastatin 20 mg','Tab','0+0+1','','Continue'),
 ('Ezetimibe 10 mg','Tab','0+0+1','','Continue'),
 ('Bisoprolol 2.5 mg','Tab','1+0+0','','Continue'),
 ('Bisoprolol 5 mg','Tab','1+0+0','','Continue'),
 ('Metoprolol succinate 25 mg','Tab','1+0+0','','Continue'),
 ('Metoprolol succinate 50 mg','Tab','1+0+0','','Continue'),
 ('Carvedilol 6.25 mg','Tab','1+0+1','After meal','Continue'),
 ('Carvedilol 12.5 mg','Tab','1+0+1','After meal','Continue'),
 ('Nebivolol 5 mg','Tab','1+0+0','','Continue'),
 ('Amlodipine 5 mg','Tab','1+0+0','','Continue'),
 ('Amlodipine 10 mg','Tab','1+0+0','','Continue'),
 ('Losartan 50 mg','Tab','1+0+0','','Continue'),
 ('Valsartan 80 mg','Tab','1+0+0','','Continue'),
 ('Telmisartan 40 mg','Tab','1+0+0','','Continue'),
 ('Ramipril 2.5 mg','Cap','1+0+0','','Continue'),
 ('Ramipril 5 mg','Cap','1+0+0','','Continue'),
 ('Lisinopril 10 mg','Tab','1+0+0','','Continue'),
 ('Sacubitril/Valsartan 50 mg','Tab','1+0+1','','Continue'),
 ('Sacubitril/Valsartan 100 mg','Tab','1+0+1','','Continue'),
 ('Furosemide 40 mg','Tab','1+0+0','Empty stomach','Continue'),
 ('Torsemide 10 mg','Tab','1+0+0','','Continue'),
 ('Spironolactone 25 mg','Tab','1+0+0','After meal','Continue'),
 ('Eplerenone 25 mg','Tab','1+0+0','','Continue'),
 ('Hydrochlorothiazide 25 mg','Tab','1+0+0','','Continue'),
 ('Indapamide 1.5 mg SR','Tab','1+0+0','','Continue'),
 ('Chlorthalidone 12.5 mg','Tab','1+0+0','','Continue'),
 ('Empagliflozin 10 mg','Tab','1+0+0','','Continue'),
 ('Dapagliflozin 10 mg','Tab','1+0+0','','Continue'),
 ('Warfarin 1 mg','Tab','0+0+1','','Continue'),
 ('Warfarin 5 mg','Tab','0+0+1','','Continue'),
 ('Apixaban 5 mg','Tab','1+0+1','','Continue'),
 ('Rivaroxaban 20 mg','Tab','0+1+0','With meal','Continue'),
 ('Dabigatran 150 mg','Cap','1+0+1','','Continue'),
 ('Digoxin 0.125 mg','Tab','1+0+0','','Continue'),
 ('Amiodarone 200 mg','Tab','1+0+0','After meal','Continue'),
 ('Ivabradine 5 mg','Tab','1+0+1','With meal','Continue'),
 ('Isosorbide mononitrate 30 mg SR','Tab','1+0+0','','Continue'),
 ('Glyceryl trinitrate 0.5 mg','SL','SOS','',''),
 ('Nicorandil 10 mg','Tab','1+0+1','','Continue'),
 ('Trimetazidine 35 mg MR','Tab','1+0+1','With meal','Continue'),
 ('Ranolazine 500 mg','Tab','1+0+1','','Continue'),
 ('Diltiazem 90 mg SR','Tab','1+0+1','','Continue'),
 ('Verapamil 40 mg','Tab','1+0+1','','Continue'),
 ('Hydralazine 25 mg','Tab','1+1+1','','Continue'),
 ('Potassium chloride 600 mg','Tab','1+0+1','After meal','15 days'),
 ('Pantoprazole 40 mg','Tab','1+0+0','Empty stomach','Continue'),
 ('Esomeprazole 40 mg','Cap','1+0+0','Empty stomach','Continue'),
 ('Metformin 500 mg','Tab','1+0+1','After meal','Continue'),
 ('Sitagliptin 50 mg','Tab','1+0+0','','Continue'),
 ('Allopurinol 100 mg','Tab','0+0+1','After meal','Continue'),
 ('Alprazolam 0.25 mg','Tab','0+0+1','At bedtime','15 days'),
 ('Paracetamol 500 mg','Tab','SOS','After meal','')
on conflict do nothing;

-- Starter prescription templates. Doses are common starting examples only -
-- the doctor reviews and edits every template in Settings → Rx templates.
insert into public.rx_templates (name, diagnosis, medicines, investigations, advice, is_starter, sort_order) values
('Hypertension', 'Essential hypertension',
 '[{"form":"Tab","name":"Amlodipine 5 mg","pattern":"1+0+0","timing":"","duration":"1 month"},
   {"form":"Tab","name":"Losartan 50 mg","pattern":"1+0+0","timing":"","duration":"1 month"}]',
 '{"Lipid profile","RFT (urea, creatinine)","Serum electrolytes","FBS","ECG"}',
 E'Low salt diet - نمک کم کھائیں\nCheck BP at home and keep a record - گھر پر بلڈ پریشر چیک کر کے لکھتے رہیں\nDaily 30-minute walk - روزانہ 30 منٹ پیدل چلیں',
 true, 1),
('IHD / Post-PCI', 'Ischaemic heart disease',
 '[{"form":"Tab","name":"Aspirin 75 mg","pattern":"0+1+0","timing":"After meal","duration":"Continue"},
   {"form":"Tab","name":"Clopidogrel 75 mg","pattern":"0+1+0","timing":"After meal","duration":"Continue"},
   {"form":"Tab","name":"Atorvastatin 40 mg","pattern":"0+0+1","timing":"","duration":"Continue"},
   {"form":"Tab","name":"Bisoprolol 2.5 mg","pattern":"1+0+0","timing":"","duration":"Continue"},
   {"form":"Tab","name":"Pantoprazole 40 mg","pattern":"1+0+0","timing":"Empty stomach","duration":"Continue"},
   {"form":"SL","name":"Glyceryl trinitrate 0.5 mg","pattern":"SOS","timing":"","duration":"","note":"Under the tongue for chest pain"}]',
 '{"Lipid profile","HbA1c","RFT (urea, creatinine)","ECG"}',
 E'Do not stop blood thinners without asking - خون پتلا کرنے والی دوائیں مشورے کے بغیر بند نہ کریں\nIn case of chest pain, go to emergency immediately - سینے میں درد کی صورت میں فوراً ایمرجنسی جائیں\nStop smoking - سگریٹ نوشی ترک کریں',
 true, 2),
('Heart failure (HFrEF)', 'Heart failure with reduced ejection fraction',
 '[{"form":"Tab","name":"Furosemide 40 mg","pattern":"1+0+0","timing":"Empty stomach","duration":"Continue"},
   {"form":"Tab","name":"Bisoprolol 2.5 mg","pattern":"1+0+0","timing":"","duration":"Continue"},
   {"form":"Tab","name":"Sacubitril/Valsartan 50 mg","pattern":"1+0+1","timing":"","duration":"Continue"},
   {"form":"Tab","name":"Spironolactone 25 mg","pattern":"1+0+0","timing":"After meal","duration":"Continue"},
   {"form":"Tab","name":"Empagliflozin 10 mg","pattern":"1+0+0","timing":"","duration":"Continue"}]',
 '{"RFT (urea, creatinine)","Serum electrolytes","NT-proBNP","Echocardiography"}',
 E'Fluid restriction 1.5 litres per day - دن میں ڈیڑھ لیٹر سے زیادہ پانی/مشروبات نہ لیں\nLow salt diet - نمک کم کھائیں\nCheck weight daily; report a gain of 2 kg in 3 days - روزانہ وزن کریں؛ 3 دن میں 2 کلو بڑھے تو فوراً رابطہ کریں',
 true, 3),
('Atrial fibrillation (warfarin)', 'Atrial fibrillation',
 '[{"form":"Tab","name":"Warfarin 5 mg","pattern":"0+0+1","timing":"","duration":"Continue","note":"Dose as per INR"},
   {"form":"Tab","name":"Bisoprolol 2.5 mg","pattern":"1+0+0","timing":"","duration":"Continue"}]',
 '{"PT / INR","TSH","Echocardiography"}',
 E'Get INR checked before next visit - اگلی بار آنے سے پہلے INR ٹیسٹ کروائیں\nReport any bleeding immediately - کسی بھی قسم کے خون آنے پر فوراً رابطہ کریں\nDo not start any new medicine without asking - مشورے کے بغیر کوئی نئی دوا شروع نہ کریں',
 true, 4),
('Dyslipidaemia', 'Dyslipidaemia',
 '[{"form":"Tab","name":"Rosuvastatin 10 mg","pattern":"0+0+1","timing":"","duration":"3 months"}]',
 '{"Lipid profile","LFT"}',
 E'Avoid fried and fatty food - تلی ہوئی اور چکنائی والی چیزوں سے پرہیز کریں\nDaily 30-minute walk - روزانہ 30 منٹ پیدل چلیں',
 true, 5)
on conflict do nothing;

drop function if exists public._pol(text,text,text,text,text);

-- =====================================================================
-- End of final_supabase.sql
-- =====================================================================
