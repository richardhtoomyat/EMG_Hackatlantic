-- ============================================================================
-- Share with Coach: athletes create a one-time code, coaches redeem it.
--
--   * create_share_code()      athlete → new 6-character code (valid 7 days,
--                              single use; replaces the athlete's older codes)
--   * claim_share_code(code)   coach   → creates the coach_links row
--   * athletes and coaches can remove a link they are part of
--
-- Codes and links are visible only to the people involved (this replaces the
-- public read on coach_links from demo_read_access.sql). Safe to re-run.
-- Run in Supabase → SQL Editor.
-- ============================================================================

create table if not exists public.share_codes (
  code       text primary key,
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days'
);
alter table public.share_codes enable row level security;
revoke all on public.share_codes from anon, authenticated;
grant select, delete on public.share_codes to authenticated;

drop policy if exists "own share codes read" on public.share_codes;
create policy "own share codes read" on public.share_codes
  for select to authenticated using (athlete_id = auth.uid());
drop policy if exists "own share codes delete" on public.share_codes;
create policy "own share codes delete" on public.share_codes
  for delete to authenticated using (athlete_id = auth.uid());

-- coach_links: only the athlete and the coach of a link can see or remove it,
-- and links can only be created by redeeming a code. Every existing policy on
-- the table is dropped first: policies are OR-ed, so an older broad one (e.g.
-- "authenticated can insert/delete") would otherwise still let anyone link
-- themselves to, or unlink, any athlete.
alter table public.coach_links enable row level security;
alter table public.coach_links alter column id set default gen_random_uuid();
do $$
declare pol record;
begin
  for pol in select policyname from pg_policies where schemaname = 'public' and tablename = 'coach_links' loop
    execute format('drop policy %I on public.coach_links', pol.policyname);
  end loop;
end $$;
create policy "linked parties read" on public.coach_links
  for select to authenticated using (athlete_id = auth.uid() or coach_id = auth.uid());
create policy "linked parties delete" on public.coach_links
  for delete to authenticated using (athlete_id = auth.uid() or coach_id = auth.uid());
revoke insert, update on public.coach_links from anon, authenticated;
grant select, delete on public.coach_links to authenticated;
revoke all on public.coach_links from anon;

-- Athlete: make a fresh code. Letters/digits without look-alikes (0/O, 1/I/L).
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

-- Coach: redeem a code → link to that athlete. Single use.
create or replace function public.claim_share_code(p_code text)
returns table (athlete_id uuid, athlete_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  wanted text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  sc share_codes%rowtype;
begin
  if me is null then
    raise exception 'Sign in first';
  end if;
  if not exists (select 1 from profiles where id = me and lower(role) = 'coach') then
    raise exception 'Only coach accounts can use share codes';
  end if;

  select * into sc from share_codes where code = wanted for update;
  if not found or sc.expires_at < now() then
    raise exception 'That code is invalid or has expired';
  end if;
  if sc.athlete_id = me then
    raise exception 'You cannot link to yourself';
  end if;

  if not exists (select 1 from coach_links l where l.athlete_id = sc.athlete_id and l.coach_id = me) then
    insert into coach_links (id, athlete_id, coach_id, share_code, linked_since)
    values (gen_random_uuid(), sc.athlete_id, me, sc.code, now());
  end if;
  delete from share_codes where code = sc.code;

  return query
    select p.id, coalesce(nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), p.name)
    from profiles p where p.id = sc.athlete_id;
end;
$$;

revoke all on function public.create_share_code() from public, anon;
revoke all on function public.claim_share_code(text) from public, anon;
grant execute on function public.create_share_code() to authenticated;
grant execute on function public.claim_share_code(text) to authenticated;
