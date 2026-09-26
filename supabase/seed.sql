-- ============================================================================
-- activateMyo — demo seed data (mirrors src/data/mockData.ts)
-- Run AFTER schema.sql. Safe to re-run: it wipes and reloads the demo athlete.
-- Session dates are relative to now() so "Today" / "This Week" always look live.
-- ============================================================================

delete from public.athletes where id = '00000000-0000-0000-0000-000000000001';

insert into public.athletes (id, name, email, height_label, weight_label, age, sensors_connected)
values ('00000000-0000-0000-0000-000000000001', 'Alex Kim', 'alex@activatemyo.io',
        '5''10" (178 cm)', '175 lbs (79 kg)', 28, true);

insert into public.coach_links (athlete_id, coach_name, share_code, linked_at)
values ('00000000-0000-0000-0000-000000000001', 'Coach Maya', 'A9K2M7', now() - interval '3 days');

insert into public.readiness_snapshots (athlete_id, score, label, description)
values ('00000000-0000-0000-0000-000000000001', 82, 'Recovered', 'Recovered. Good day to activate.');

insert into public.sessions
  (id, athlete_id, exercise_name, started_at, total_reps, workout_volume, total_tut_sec,
   avg_peak_activation_pct, avg_activation_pct, imbalance_pct, activation_score, coach_name, coach_message)
values
  ('demo-sess-today', '00000000-0000-0000-0000-000000000001', 'Bicep Curl',
   date_trunc('day', now()) + interval '14 hours 14 minutes', 24, 1872, 402, 86, 68, 18, 78,
   'Coach Maya', 'Good form on sets 1–2. Keep core tight on set 3.'),
  ('demo-sess-d2', '00000000-0000-0000-0000-000000000001', 'Squat',
   date_trunc('day', now()) - interval '2 days' + interval '9 hours', 18, 2700, 360, 80, 64, 12, 71, null, null),
  ('demo-sess-d3', '00000000-0000-0000-0000-000000000001', 'Shoulder Press',
   date_trunc('day', now()) - interval '3 days' + interval '18 hours', 20, 1500, 330, 84, 66, 20, 64, null, null),
  ('demo-sess-d5', '00000000-0000-0000-0000-000000000001', 'Deadlift',
   date_trunc('day', now()) - interval '5 days' + interval '17 hours', 15, 3300, 300, 78, 60, 22, 58, null, null);

insert into public.session_sets (session_id, set_number, reps, tut_sec, peak_activation_pct, avg_activation_pct)
values
  ('demo-sess-today', 1, 8, 134, 84, 68),
  ('demo-sess-today', 2, 8, 148, 89, 72),
  ('demo-sess-today', 3, 8, 130, 81, 64);

insert into public.muscle_activations (session_id, muscle, pct)
values
  ('demo-sess-today', 'Left Bicep', 68),
  ('demo-sess-today', 'Right Bicep', 54),
  ('demo-sess-today', 'Shoulders', 26),
  ('demo-sess-today', 'Forearms', 31);

insert into public.live_sets
  (athlete_id, exercise_name, left_pct, right_pct, imbalance_pct, reps, tut_sec, peak_activation_pct, fatigue_label)
values
  ('00000000-0000-0000-0000-000000000001', 'Bicep Curl', 68, 54, 20, 8, 134, 89, 'Moderate');
