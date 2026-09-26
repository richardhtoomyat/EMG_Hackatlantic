-- ============================================================================
-- Test data for ONE account, shaped to exercise each screen of the app.
-- 1. Set target_email below to the account you sign in with (email or Google).
-- 2. Run in Supabase → SQL Editor. Re-running replaces the previous test rows.
-- 3. Clean up with test_data_cleanup.sql. Test rows' ids start with 7e57da7a-.
--
-- What each block is for:
--   T1  today, latest   → Session screen: coach feedback, big L/R imbalance,
--                          stored muscle_map; Today metrics
--   T2  today, earlier  → Today: body map = union of T1 + T2, reps summed
--   W1–W3 this week     → This Week bars, History list, Weekly Trends
--   W3  6 days ago      → oldest bar still inside the 7-day window
--   L1  9 days ago      → History only; must NOT count in This Week / trends
--   E1  no sets         → a session with 0 reps renders without errors
--   Coach link          → Coach screen (only if a coach profile exists)
-- "Today" uses the database clock; run it at least 3 h after local midnight.
-- ============================================================================
do $$
declare
  target_email text := 'alex@activatemyo.io';   -- ← change me
  me    uuid;
  coach uuid;
  t1 uuid; t2 uuid; w1 uuid; w2 uuid; w3 uuid; l1 uuid; e1 uuid;
begin
  select id into me from auth.users where lower(email) = lower(target_email);
  if me is null then
    raise exception 'No auth user with email %', target_email;
  end if;
  if not exists (select 1 from public.profiles where id = me) then
    raise exception 'User % has no profiles row — run signup_profiles.sql first', target_email;
  end if;

  -- replace earlier test rows for this user
  delete from public.sets where session_id in
    (select id from public.sessions where athlete_id = me and id::text like '7e57da7a-%');
  delete from public.sessions where athlete_id = me and id::text like '7e57da7a-%';

  t1 := ('7e57da7a' || substr(gen_random_uuid()::text, 9))::uuid;
  t2 := ('7e57da7a' || substr(gen_random_uuid()::text, 9))::uuid;
  w1 := ('7e57da7a' || substr(gen_random_uuid()::text, 9))::uuid;
  w2 := ('7e57da7a' || substr(gen_random_uuid()::text, 9))::uuid;
  w3 := ('7e57da7a' || substr(gen_random_uuid()::text, 9))::uuid;
  l1 := ('7e57da7a' || substr(gen_random_uuid()::text, 9))::uuid;
  e1 := ('7e57da7a' || substr(gen_random_uuid()::text, 9))::uuid;

  insert into public.sessions (id, athlete_id, exercise_name, started_at, ended_at, activation_score, feedback, muscle_map) values
    (t1, me, 'Bicep Curl',     now() - interval '30 minutes', now() - interval '12 minutes', 74,
         'Left arm is doing most of the work — slow down the right side and match tempo.',
         '{"f-bicep-l":"primary","f-bicep-r":"primary","f-forearm-l":"secondary","f-forearm-r":"secondary","f-delt-l":"secondary","f-delt-r":"secondary"}'),
    (t2, me, 'Squat',          now() - interval '3 hours',    now() - interval '2 hours 40 minutes', 69, null, null),
    (w1, me, 'Shoulder Press', now() - interval '2 days',     now() - interval '2 days' + interval '15 minutes', 81, null, null),
    (w2, me, 'Deadlift',       now() - interval '4 days',     now() - interval '4 days' + interval '20 minutes', 66, null, null),
    (e1, me, 'Tricep Dips',    now() - interval '5 days',     now() - interval '5 days' + interval '5 minutes', 40, 'Stopped early — no sets recorded.', null),
    (w3, me, 'Pull-Up',        now() - interval '6 days',     now() - interval '6 days' + interval '12 minutes', 88, null, null),
    (l1, me, 'Tricep Dips',    now() - interval '9 days',     now() - interval '9 days' + interval '10 minutes', 55, null, null);

  insert into public.sets (id, session_id, set_number, reps, time_under_tension_seconds, peak_activation, contraction_pct, recovery_seconds, muscle_pct) values
    -- T1: strong left/right imbalance (~30%)
    (gen_random_uuid(), t1, 1, 10, 42, 91, 70, 90, '{"Left Bicep":76,"Right Bicep":52,"Left Forearm":30,"Right Forearm":27}'),
    (gen_random_uuid(), t1, 2, 10, 45, 88, 67, 90, '{"Left Bicep":74,"Right Bicep":50,"Left Forearm":31,"Right Forearm":26}'),
    (gen_random_uuid(), t1, 3,  8, 38, 83, 61, 0,  '{"Left Bicep":70,"Right Bicep":49,"Left Forearm":29,"Right Forearm":25}'),
    -- T2: balanced
    (gen_random_uuid(), t2, 1, 8, 36, 84, 66, 120, '{"Left Quad":68,"Right Quad":66,"Left Glute":55,"Right Glute":54}'),
    (gen_random_uuid(), t2, 2, 8, 38, 82, 64, 0,   '{"Left Quad":66,"Right Quad":65,"Left Glute":53,"Right Glute":52}'),
    -- W1
    (gen_random_uuid(), w1, 1, 10, 40, 86, 69, 90, '{"Left Delt":70,"Right Delt":61}'),
    (gen_random_uuid(), w1, 2, 10, 41, 85, 68, 0,  '{"Left Delt":69,"Right Delt":60}'),
    -- W2
    (gen_random_uuid(), w2, 1, 5, 30, 90, 72, 150, '{"Left Hamstring":62,"Right Hamstring":60,"Lower Back":58}'),
    (gen_random_uuid(), w2, 2, 5, 31, 87, 70, 150, '{"Left Hamstring":61,"Right Hamstring":58,"Lower Back":57}'),
    (gen_random_uuid(), w2, 3, 5, 29, 85, 67, 0,   '{"Left Hamstring":59,"Right Hamstring":57,"Lower Back":55}'),
    -- W3: best session of the week
    (gen_random_uuid(), w3, 1, 8, 34, 94, 78, 120, '{"Left Lat":80,"Right Lat":78}'),
    (gen_random_uuid(), w3, 2, 7, 31, 92, 75, 0,   '{"Left Lat":77,"Right Lat":76}'),
    -- L1: last week
    (gen_random_uuid(), l1, 1, 12, 44, 80, 60, 90, '{"Left Tricep":62,"Right Tricep":58}'),
    (gen_random_uuid(), l1, 2, 10, 40, 78, 58, 0,  '{"Left Tricep":60,"Right Tricep":56}');
    -- E1 intentionally has no sets

  -- Coach screen: link the first coach profile, if any, and none is linked yet.
  select id into coach from public.profiles where role = 'coach' and id <> me order by created_at limit 1;
  if coach is not null and not exists (select 1 from public.coach_links where athlete_id = me) then
    insert into public.coach_links (id, athlete_id, coach_id, share_code, linked_since)
    values (('7e57da7a' || substr(gen_random_uuid()::text, 9))::uuid, me, coach,
            upper(substr(md5(random()::text), 1, 6)), now() - interval '1 day');
  end if;

  raise notice 'Inserted 7 test sessions (14 sets) for %', target_email;
end $$;
