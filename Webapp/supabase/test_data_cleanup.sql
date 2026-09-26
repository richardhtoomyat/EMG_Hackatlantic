-- Removes everything test_data.sql created (rows whose id starts with 7e57da7a-).
-- Leave target_email empty to clean up test rows for ALL users.
do $$
declare
  target_email text := '';   -- ← optional: limit to one account
  me uuid;
begin
  if target_email <> '' then
    select id into me from auth.users where lower(email) = lower(target_email);
  end if;
  delete from public.sets where session_id in
    (select id from public.sessions where id::text like '7e57da7a-%' and (me is null or athlete_id = me));
  delete from public.sessions    where id::text like '7e57da7a-%' and (me is null or athlete_id = me);
  delete from public.coach_links where id::text like '7e57da7a-%' and (me is null or athlete_id = me);
end $$;
