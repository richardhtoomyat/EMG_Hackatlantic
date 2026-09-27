-- ============================================================================
-- Remove the hackathon "demo public read" (supabase/demo_read_access.sql).
--
-- Until now anyone — even without signing in — could read every profile
-- (names, emails, birth dates, weights), session and set. After this:
--   * profiles: your own row, plus the coach/athlete you are linked with
--   * sessions / sets: your own, plus those of athletes you coach
--   * not signed in: nothing
-- The station / Vercel API uses the service role key and is unaffected.
--
-- Run AFTER coach_sharing.sql and roles.sql (roles.sql adds the linked
-- coach ↔ athlete profile read the Coach screens need). Safe to re-run.
-- Run in Supabase → SQL Editor. To undo, run demo_read_access.sql again.
-- ============================================================================

drop policy if exists "demo public read" on public.profiles;
drop policy if exists "demo public read" on public.sessions;
drop policy if exists "demo public read" on public.sets;
drop policy if exists "demo public read" on public.coach_links;  -- coach_sharing.sql already removes it

-- The reads the app needs, stated explicitly (policies are OR-ed, so these
-- are harmless if an equivalent older policy also exists).
alter table public.profiles enable row level security;
alter table public.sessions enable row level security;
alter table public.sets     enable row level security;

drop policy if exists "own profile read" on public.profiles;
create policy "own profile read" on public.profiles
  for select to authenticated using (id = auth.uid());

drop policy if exists "linked parties read profiles" on public.profiles;
create policy "linked parties read profiles" on public.profiles
  for select to authenticated
  using (exists (select 1 from public.coach_links l
                 where (l.athlete_id = profiles.id and l.coach_id = auth.uid())
                    or (l.coach_id = profiles.id and l.athlete_id = auth.uid())));

drop policy if exists "own sessions read" on public.sessions;
create policy "own sessions read" on public.sessions
  for select to authenticated using (athlete_id = auth.uid());

drop policy if exists "linked coach reads sessions" on public.sessions;
create policy "linked coach reads sessions" on public.sessions
  for select to authenticated
  using (exists (select 1 from public.coach_links l
                 where l.athlete_id = sessions.athlete_id and l.coach_id = auth.uid()));

drop policy if exists "own sets read" on public.sets;
create policy "own sets read" on public.sets
  for select to authenticated
  using (exists (select 1 from public.sessions s where s.id = sets.session_id and s.athlete_id = auth.uid()));

drop policy if exists "linked coach reads sets" on public.sets;
create policy "linked coach reads sets" on public.sets
  for select to authenticated
  using (exists (select 1 from public.sessions s
                 join public.coach_links l on l.athlete_id = s.athlete_id
                 where s.id = sets.session_id and l.coach_id = auth.uid()));

-- Signed-out visitors read nothing from these tables.
revoke select on public.profiles, public.sessions, public.sets, public.coach_links from anon;

-- Check: no policy should still read "true" for everyone.
select tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public'
  and tablename in ('profiles', 'sessions', 'sets', 'coach_links')
  and cmd in ('SELECT', 'ALL')
order by tablename, policyname;
