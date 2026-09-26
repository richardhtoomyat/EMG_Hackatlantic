-- ============================================================================
-- activateMyo — Supabase schema
-- ============================================================================
-- Run this once in the Supabase dashboard → SQL Editor → New query → Run.
-- Then run supabase/seed.sql to load demo data matching the prototype.
--
-- Stores session-level data only (not raw high-frequency EMG). The one
-- "live" table, live_sets, is meant to be upserted ~a few times per second
-- by the FastAPI hub and is broadcast to the web app via Supabase Realtime.
-- ============================================================================

create extension if not exists "pgcrypto";

create table if not exists public.athletes (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  email             text,
  height_label      text,
  weight_label      text,
  age               int,
  sensors_connected boolean not null default false,
  created_at        timestamptz not null default now()
);

create table if not exists public.coach_links (
  id          uuid primary key default gen_random_uuid(),
  athlete_id  uuid not null references public.athletes(id) on delete cascade,
  coach_name  text not null,
  share_code  text not null unique,
  linked_at   timestamptz not null default now()
);

create table if not exists public.readiness_snapshots (
  id          uuid primary key default gen_random_uuid(),
  athlete_id  uuid not null references public.athletes(id) on delete cascade,
  score       int not null check (score between 0 and 100),
  label       text not null,
  description text not null,
  recorded_at timestamptz not null default now()
);

create table if not exists public.sessions (
  id                        text primary key default gen_random_uuid()::text,
  athlete_id                uuid not null references public.athletes(id) on delete cascade,
  exercise_name             text not null,
  started_at                timestamptz not null default now(),
  total_reps                int not null default 0,
  workout_volume            int not null default 0,
  total_tut_sec             int not null default 0,
  avg_peak_activation_pct   int not null default 0,
  avg_activation_pct        int not null default 0,
  imbalance_pct             int not null default 0,
  activation_score          int not null default 0 check (activation_score between 0 and 100),
  coach_name                text,
  coach_message             text
);
create index if not exists sessions_athlete_started_idx
  on public.sessions (athlete_id, started_at desc);

create table if not exists public.session_sets (
  id                  uuid primary key default gen_random_uuid(),
  session_id          text not null references public.sessions(id) on delete cascade,
  set_number          int not null,
  reps                int not null,
  tut_sec             int not null,
  peak_activation_pct int not null,
  avg_activation_pct  int not null,
  unique (session_id, set_number)
);

create table if not exists public.muscle_activations (
  id         uuid primary key default gen_random_uuid(),
  session_id text not null references public.sessions(id) on delete cascade,
  muscle     text not null,
  pct        int not null
);

-- One row per athlete: the set currently in progress (Workout screen).
create table if not exists public.live_sets (
  athlete_id          uuid primary key references public.athletes(id) on delete cascade,
  exercise_name       text not null,
  left_pct            int not null default 0,
  right_pct           int not null default 0,
  imbalance_pct       int not null default 0,
  reps                int not null default 0,
  tut_sec             int not null default 0,
  peak_activation_pct int not null default 0,
  fatigue_label       text not null default 'Low',
  updated_at          timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------------------
-- HACKATHON / DEMO POLICY: the public (anon) key may READ everything so the
-- static Vercel site works without login. Writes are only possible with the
-- service_role key (FastAPI hub / ESP32 bridge), which bypasses RLS.
-- Replace these with auth.uid()-based policies once Supabase Auth is added.
alter table public.athletes            enable row level security;
alter table public.coach_links         enable row level security;
alter table public.readiness_snapshots enable row level security;
alter table public.sessions            enable row level security;
alter table public.session_sets        enable row level security;
alter table public.muscle_activations  enable row level security;
alter table public.live_sets           enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'athletes','coach_links','readiness_snapshots','sessions',
    'session_sets','muscle_activations','live_sets'
  ] loop
    execute format('drop policy if exists "public read" on public.%I', t);
    execute format('create policy "public read" on public.%I for select using (true)', t);
  end loop;
end $$;

-- Broadcast live_sets changes to the web app (Workout screen).
do $$
begin
  alter publication supabase_realtime add table public.live_sets;
exception when duplicate_object then null;
end $$;
