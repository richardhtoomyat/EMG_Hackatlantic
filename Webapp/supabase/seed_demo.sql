-- ============================================================================
-- OPTIONAL — demo data for the existing tables (profiles, coach_links,
-- sessions, sets), matching the prototype's mock data. Dates are relative
-- to now() so "Today" / "This Week" look live.
--
-- If profiles.id references auth.users, create two users first
-- (Authentication → Users → Add user) — the first becomes the athlete and
-- the second the coach. Otherwise fixed placeholder ids are used.
-- Run in Supabase → SQL Editor. Re-running replaces this demo data.
-- ============================================================================
do $$
declare
  athlete uuid;
  coach   uuid;
  s_today uuid := gen_random_uuid();
  s_d2    uuid := gen_random_uuid();
  s_d3    uuid := gen_random_uuid();
begin
  select id into athlete from auth.users order by created_at limit 1;
  select id into coach   from auth.users order by created_at offset 1 limit 1;
  athlete := coalesce(athlete, 'a0000000-0000-0000-0000-000000000001');
  coach   := coalesce(coach,   'c0000000-0000-0000-0000-000000000001');

  delete from public.sets where session_id in (select id from public.sessions where athlete_id = athlete);
  delete from public.sessions    where athlete_id = athlete;
  delete from public.coach_links where athlete_id = athlete;

  insert into public.profiles (id, name, role, height_cm, weight_kg, age, sensors_connected)
  values (athlete, 'Alex Kim', 'athlete', 178, 79, 28, true),
         (coach,   'Coach Maya', 'coach', null, null, null, false)
  on conflict (id) do update set
    name = excluded.name, role = excluded.role, height_cm = excluded.height_cm,
    weight_kg = excluded.weight_kg, age = excluded.age, sensors_connected = excluded.sensors_connected;

  insert into public.coach_links (id, athlete_id, coach_id, share_code, linked_since)
  values (gen_random_uuid(), athlete, coach, 'A9K2M7', now() - interval '3 days');

  insert into public.sessions (id, athlete_id, exercise_name, started_at, ended_at, activation_score, feedback, muscle_map)
  values
    (s_today, athlete, 'Bicep Curl',
     date_trunc('day', now()) + interval '14 hours 14 minutes',
     date_trunc('day', now()) + interval '14 hours 30 minutes', 78,
     'Good form on sets 1–2. Keep core tight on set 3.',
     '{"f-bicep-l":"primary","f-bicep-r":"primary","f-forearm-l":"secondary","f-forearm-r":"secondary","f-delt-l":"secondary","f-delt-r":"secondary"}'),
    (s_d2, athlete, 'Squat',
     date_trunc('day', now()) - interval '2 days' + interval '9 hours',
     date_trunc('day', now()) - interval '2 days' + interval '9 hours 20 minutes', 72, null, null),
    (s_d3, athlete, 'Shoulder Press',
     date_trunc('day', now()) - interval '3 days' + interval '18 hours',
     date_trunc('day', now()) - interval '3 days' + interval '18 hours 15 minutes', 81, null, null);

  insert into public.sets (id, session_id, set_number, reps, time_under_tension_seconds, peak_activation, contraction_pct, recovery_seconds, muscle_pct)
  values
    (gen_random_uuid(), s_today, 1, 8, 134, 84, 68, 90, '{"Left Bicep":70,"Right Bicep":55,"Shoulders":25,"Forearms":30}'),
    (gen_random_uuid(), s_today, 2, 8, 148, 89, 72, 90, '{"Left Bicep":72,"Right Bicep":56,"Shoulders":27,"Forearms":33}'),
    (gen_random_uuid(), s_today, 3, 8, 130, 81, 64, 0,  '{"Left Bicep":62,"Right Bicep":51,"Shoulders":26,"Forearms":30}'),
    (gen_random_uuid(), s_d2, 1, 6, 120, 80, 64, 120, '{"Left Quad":66,"Right Quad":60}'),
    (gen_random_uuid(), s_d2, 2, 6, 118, 78, 62, 120, '{"Left Quad":64,"Right Quad":58}'),
    (gen_random_uuid(), s_d2, 3, 6, 122, 82, 63, 0,   '{"Left Quad":65,"Right Quad":57}'),
    (gen_random_uuid(), s_d3, 1, 10, 165, 84, 66, 90, '{"Left Delt":68,"Right Delt":54}'),
    (gen_random_uuid(), s_d3, 2, 10, 165, 85, 67, 0,  '{"Left Delt":69,"Right Delt":55}');
end $$;
