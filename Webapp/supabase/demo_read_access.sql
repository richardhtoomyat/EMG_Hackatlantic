-- ============================================================================
-- OPTIONAL — hackathon demo mode: let the public (anon) key READ the app's
-- tables so the Vercel site can show data without anyone logging in.
-- Read-only: no insert/update/delete is granted. Remove these policies once
-- Supabase Auth is wired into the front-end.
-- Run in Supabase → SQL Editor.
-- ============================================================================
do $$
declare t text;
begin
  foreach t in array array['profiles', 'coach_links', 'sessions', 'sets'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "demo public read" on public.%I', t);
    execute format('create policy "demo public read" on public.%I for select to anon, authenticated using (true)', t);
  end loop;
end $$;
