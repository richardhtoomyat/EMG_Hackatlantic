-- ============================================================================
-- Athlete / coach role for every account (email AND Google sign-up) + what a
-- linked coach may read. Safe to re-run. Run in Supabase → SQL Editor after
-- signup_profiles.sql and coach_sharing.sql.
--
--   * profiles.role_selected_at: when the user chose athlete/coach. NULL means
--     "not chosen yet" → the app asks before anything else (like body metrics).
--     Email sign-ups choose on the form; Google sign-ups are asked on first
--     sign-in.
--   * set_my_role(role): the only way to set/change your own role. Changing it
--     later is allowed only while you have no coach links (so an existing
--     athlete↔coach link can't end up pointing at the wrong kind of account).
--   * Linked coaches may read their athletes' profiles and EMG recordings
--     (calibrations, baselines/strain, per-set curves) — sessions and sets
--     already have coach read policies.
-- ============================================================================

alter table public.profiles add column if not exists role_selected_at timestamptz;

-- Existing accounts: count the role as chosen where we know it was a choice —
-- picked on the email sign-up form (role in the user metadata), or already
-- part of a coach link. Everyone else (e.g. Google accounts that were silently
-- made athletes) is asked once.
update public.profiles p
set role_selected_at = coalesce(u.created_at, now())
from auth.users u
where u.id = p.id
  and p.role_selected_at is null
  and (u.raw_user_meta_data ? 'role'
       or exists (select 1 from public.coach_links l where l.athlete_id = p.id or l.coach_id = p.id));

-- New users: the sign-up trigger records whether the role was chosen on the form.
create or replace function public.activatemyo_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare f record;
begin
  select * into f from public.activatemyo_profile_fields(new);
  insert into public.profiles (id, name, first_name, last_name, avatar_url, email, role, sensors_connected, role_selected_at)
  values (new.id, f.full_name, f.first_name, f.last_name, f.avatar_url, new.email, f.role, false,
          case when coalesce(new.raw_user_meta_data, '{}'::jsonb) ? 'role' then now() end)
  on conflict (id) do update set
    first_name = coalesce(public.profiles.first_name, excluded.first_name),
    last_name  = coalesce(public.profiles.last_name,  excluded.last_name),
    avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url),
    email      = coalesce(public.profiles.email,      excluded.email);
  return new;
end;
$$;

-- Users may edit only their name and body metrics directly (same as
-- body_metrics.sql); role and role_selected_at change only via set_my_role().
revoke update on public.profiles from anon, authenticated;
do $$
declare col text;
begin
  foreach col in array array['first_name', 'last_name', 'height_cm', 'weight_kg', 'age', 'birth_date',
                              'weight_updated_at', 'height_updated_at'] loop
    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'profiles' and column_name = col) then
      execute format('grant update (%I) on public.profiles to authenticated', col);
    end if;
  end loop;
end $$;

-- Choose (or, with no coach links, change) your own role.
create or replace function public.set_my_role(p_role text)
returns table (role text, role_selected_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  wanted text := lower(trim(coalesce(p_role, '')));
  cur record;
begin
  if me is null then
    raise exception 'Sign in first';
  end if;
  if wanted not in ('athlete', 'coach') then
    raise exception 'Role must be athlete or coach';
  end if;
  select p.role, p.role_selected_at into cur from profiles p where p.id = me for update;
  if not found then
    raise exception 'No profile for this user';
  end if;
  if cur.role_selected_at is not null and lower(coalesce(cur.role, '')) <> wanted
     and exists (select 1 from coach_links l where l.athlete_id = me or l.coach_id = me) then
    raise exception 'Remove your coach/athlete links first, then change your role';
  end if;
  if wanted = 'coach' then
    delete from share_codes s where s.athlete_id = me;  -- a coach has no athlete share code
  end if;
  update profiles p set role = wanted, role_selected_at = coalesce(
    case when lower(coalesce(cur.role, '')) = wanted then cur.role_selected_at end, now())
  where p.id = me;
  return query select p.role, p.role_selected_at from profiles p where p.id = me;
end;
$$;
revoke all on function public.set_my_role(text) from public, anon;
grant execute on function public.set_my_role(text) to authenticated;

-- Athletes create share codes, coaches redeem them (claim_share_code already
-- checks the coach side). Only athletes may make a code.
create or replace function public.create_share_code()
returns table (code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  new_code text;
begin
  if me is null then
    raise exception 'Sign in first';
  end if;
  if not exists (select 1 from profiles where id = me) then
    raise exception 'No profile for this user';
  end if;
  if exists (select 1 from profiles where id = me and lower(role) = 'coach') then
    raise exception 'Only athlete accounts can share their training';
  end if;

  delete from share_codes where athlete_id = me;  -- one active code at a time
  loop
    new_code := '';
    for i in 1..6 loop
      new_code := new_code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from share_codes s where s.code = new_code)
          and not exists (select 1 from coach_links l where l.share_code = new_code);
  end loop;

  insert into share_codes (code, athlete_id) values (new_code, me);
  return query select s.code, s.expires_at from share_codes s where s.code = new_code;
end;
$$;
revoke all on function public.create_share_code() from public, anon;
grant execute on function public.create_share_code() to authenticated;

-- Linked coach ↔ athlete can read each other's profile (name, picture, body
-- metrics) — needed once the demo-wide public read is removed.
drop policy if exists "linked parties read profiles" on public.profiles;
create policy "linked parties read profiles" on public.profiles
  for select to authenticated
  using (exists (select 1 from public.coach_links l
                 where (l.athlete_id = profiles.id and l.coach_id = auth.uid())
                    or (l.coach_id = profiles.id and l.athlete_id = auth.uid())));

-- A linked coach can read the athlete's EMG recordings (calibrations,
-- baselines, strain recordings, per-set activation curves). Read only.
drop policy if exists "linked coach reads EMG recordings" on public.emg_recordings;
create policy "linked coach reads EMG recordings" on public.emg_recordings
  for select to authenticated
  using (exists (select 1 from public.coach_links l
                 where l.athlete_id = emg_recordings.user_id and l.coach_id = auth.uid()));
