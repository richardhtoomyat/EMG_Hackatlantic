-- ============================================================================
-- Sign-up support: create a public.profiles row for every new auth user.
-- The web app's Sign up form passes { name, role } as user metadata; this
-- trigger copies them into profiles (role defaults to 'athlete').
-- Safe to re-run. Run in Supabase → SQL Editor.
-- ============================================================================
create or replace function public.activatemyo_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, role, sensors_connected)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), split_part(new.email, '@', 1)),
    case when new.raw_user_meta_data ->> 'role' = 'coach' then 'coach' else 'athlete' end,
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists activatemyo_on_auth_user_created on auth.users;
create trigger activatemyo_on_auth_user_created
  after insert on auth.users
  for each row execute function public.activatemyo_handle_new_user();

-- Backfill: profiles for any existing users that don't have one yet.
insert into public.profiles (id, name, role, sensors_connected)
select u.id,
       coalesce(nullif(u.raw_user_meta_data ->> 'name', ''), split_part(u.email, '@', 1)),
       case when u.raw_user_meta_data ->> 'role' = 'coach' then 'coach' else 'athlete' end,
       false
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id);
