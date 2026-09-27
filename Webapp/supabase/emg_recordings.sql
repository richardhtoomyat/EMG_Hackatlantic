create table if not exists public.emg_recordings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  recording_type integer not null check (recording_type in (0, 1)),
  raw_data jsonb not null
);

comment on column public.emg_recordings.recording_type is '0 = passive baseline, 1 = strain recording';

alter table public.emg_recordings enable row level security;

revoke all on public.emg_recordings from anon, authenticated;
grant select, insert, delete on public.emg_recordings to authenticated;

drop policy if exists "users read own EMG recordings" on public.emg_recordings;
create policy "users read own EMG recordings"
  on public.emg_recordings for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "users insert own EMG recordings" on public.emg_recordings;
create policy "users insert own EMG recordings"
  on public.emg_recordings for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "users delete own EMG recordings" on public.emg_recordings;
create policy "users delete own EMG recordings"
  on public.emg_recordings for delete to authenticated
  using ((select auth.uid()) = user_id);
