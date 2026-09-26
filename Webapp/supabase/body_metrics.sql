-- ============================================================================
-- Body metrics: date of birth, and when height/weight were last entered.
-- Age is derived from birth_date in the app (so it rises every birthday);
-- weight_updated_at / height_updated_at drive the in-app reminders
-- (weight every 20 days; height yearly while under 22).
--
-- Also lets a signed-in user update ONLY these columns on ONLY their own
-- profile — not their role, and not anyone else's row. Safe to re-run.
-- Run in Supabase → SQL Editor.
-- ============================================================================
alter table public.profiles add column if not exists birth_date        date;
alter table public.profiles add column if not exists weight_updated_at timestamptz;
alter table public.profiles add column if not exists height_updated_at timestamptz;

alter table public.profiles drop constraint if exists profiles_birth_date_check;
alter table public.profiles add  constraint profiles_birth_date_check
  check (birth_date is null or (birth_date > date '1900-01-01' and birth_date <= current_date));

alter table public.profiles enable row level security;
drop policy if exists "own profile update" on public.profiles;
create policy "own profile update" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Column-level: users may change their body metrics and name, nothing else.
revoke update on public.profiles from anon, authenticated;
grant update (height_cm, weight_kg, age, birth_date, weight_updated_at, height_updated_at)
  on public.profiles to authenticated;
do $$
begin
  -- name columns exist only after signup_profiles.sql
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'profiles' and column_name = 'first_name') then
    grant update (first_name, last_name) on public.profiles to authenticated;
  end if;
end $$;
