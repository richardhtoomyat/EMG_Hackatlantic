-- ============================================================================
-- Sign-up support (email + Google): keep public.profiles in sync with
-- auth.users. Adds first_name / last_name / avatar_url / email columns and a
-- trigger that fills them for every new user:
--   * email sign-up form  → first_name, last_name, role from user metadata
--   * Google sign-in      → given_name / family_name (or full_name split),
--                           avatar_url / picture, email
-- Safe to re-run (also after running an earlier version of this file).
-- Run in Supabase → SQL Editor.
-- ============================================================================
alter table public.profiles add column if not exists first_name text;
alter table public.profiles add column if not exists last_name  text;
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists email      text;

create or replace function public.activatemyo_profile_fields(u auth.users)
returns table (first_name text, last_name text, full_name text, avatar_url text, role text)
language sql
stable
as $$
  with m as (
    select coalesce(u.raw_user_meta_data, '{}'::jsonb) as d,
           coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''),
                    nullif(u.raw_user_meta_data ->> 'name', ''),
                    split_part(u.email, '@', 1)) as full_name
  )
  select
    coalesce(nullif(d ->> 'first_name', ''), nullif(d ->> 'given_name', ''), split_part(full_name, ' ', 1)),
    coalesce(nullif(d ->> 'last_name', ''), nullif(d ->> 'family_name', ''),
             nullif(trim(substr(full_name, length(split_part(full_name, ' ', 1)) + 1)), '')),
    full_name,
    coalesce(nullif(d ->> 'avatar_url', ''), nullif(d ->> 'picture', '')),
    case when d ->> 'role' = 'coach' then 'coach' else 'athlete' end
  from m;
$$;

create or replace function public.activatemyo_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare f record;
begin
  select * into f from public.activatemyo_profile_fields(new);
  insert into public.profiles (id, name, first_name, last_name, avatar_url, email, role, sensors_connected)
  values (new.id, f.full_name, f.first_name, f.last_name, f.avatar_url, new.email, f.role, false)
  on conflict (id) do update set
    first_name = coalesce(public.profiles.first_name, excluded.first_name),
    last_name  = coalesce(public.profiles.last_name,  excluded.last_name),
    avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url),
    email      = coalesce(public.profiles.email,      excluded.email);
  return new;
end;
$$;

drop trigger if exists activatemyo_on_auth_user_created on auth.users;
create trigger activatemyo_on_auth_user_created
  after insert on auth.users
  for each row execute function public.activatemyo_handle_new_user();

-- Backfill: create missing profiles and fill the new columns for existing users.
insert into public.profiles (id, name, first_name, last_name, avatar_url, email, role, sensors_connected)
select u.id, f.full_name, f.first_name, f.last_name, f.avatar_url, u.email, f.role, false
from auth.users u, lateral public.activatemyo_profile_fields(u) f
on conflict (id) do update set
  first_name = coalesce(public.profiles.first_name, split_part(public.profiles.name, ' ', 1), excluded.first_name),
  last_name  = coalesce(public.profiles.last_name,
                        nullif(trim(substr(public.profiles.name, length(split_part(public.profiles.name, ' ', 1)) + 1)), ''),
                        excluded.last_name),
  avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url),
  email      = coalesce(public.profiles.email,      excluded.email);
