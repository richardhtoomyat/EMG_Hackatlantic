-- ============================================================================
-- Shared sensor stations (PC + MyoWare), one user at a time.
--
-- Only the Vercel API (service_role key, server-side) reads or writes these
-- tables: RLS is on and there are NO policies, so the anon/authenticated keys
-- used by browsers and station PCs cannot touch them.
--   * stations          — registered PCs; who is connected; current recording
--   * connect_codes     — one-time QR codes a signed-in user shows to a station
--   * station_commands  — mailbox: start / next_set / finish / cancel
-- Live data (raw envelope + live metrics) goes through Upstash Redis and is
-- never stored. Saved results go into the existing sessions / sets tables.
-- Safe to re-run. Run in Supabase → SQL Editor.
-- ============================================================================

create table if not exists public.stations (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  key_hash             text not null,                 -- sha256 of the station secret
  created_at           timestamptz not null default now(),
  last_seen_at         timestamptz,
  sensors              jsonb not null default '{}'::jsonb,   -- {"left": true, "right": false}
  current_user_id      uuid references auth.users(id) on delete set null,
  connected_at         timestamptz,
  last_activity_at     timestamptz,                   -- last request from the connected user
  recording_session_id uuid references public.sessions(id) on delete set null
);

create table if not exists public.connect_codes (
  code_hash   text primary key,                       -- sha256 of the code in the QR
  user_id     uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz,
  station_id  uuid references public.stations(id) on delete cascade
);
create index if not exists connect_codes_user_idx on public.connect_codes (user_id, created_at desc);

create table if not exists public.station_commands (
  id           bigint generated always as identity primary key,
  station_id   uuid not null references public.stations(id) on delete cascade,
  type         text not null check (type in ('start', 'next_set', 'finish', 'cancel')),
  payload      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  delivered_at timestamptz
);
create index if not exists station_commands_pending_idx
  on public.station_commands (station_id, id) where delivered_at is null;

-- Server-only: RLS on, no policies, no grants for browser/station keys.
alter table public.stations         enable row level security;
alter table public.connect_codes    enable row level security;
alter table public.station_commands enable row level security;
revoke all on public.stations, public.connect_codes, public.station_commands from anon, authenticated;

-- The API sets sessions.id itself when it creates a session.
alter table public.sessions alter column id set default gen_random_uuid();
alter table public.sets     alter column id set default gen_random_uuid();
