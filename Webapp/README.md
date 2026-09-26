# activateMyo

A real-time muscle activation tracker built around a 2× MyoWare 2.0 EMG sensor rig
(Wireless Shields + SparkFun Thing Plus ESP32) — designed so an athlete and their
personal coach can both see live muscle tension, fatigue, and workout quality in
one clean, Oura-ring-inspired interface.

This repo is the **front-end / design prototype**: a complete, production-shaped
React app running entirely on realistic hardcoded data, so the UI, navigation, and
data model are all locked in ahead of wiring up the actual sensor pipeline.

![Today screen](docs/screenshot-today.png)

## Tech stack

- **Vite + React + TypeScript** — app shell and build tooling
- **Tailwind CSS** — styling, using a small set of custom design tokens (see below)
- **React Router (`HashRouter`)** — client-side routing; hash-based specifically so
  the built app can be hosted as static files (e.g. GitHub Pages) with zero server
  routing configuration
- Pure SVG components (body map, activation rings) with no chart/graphics
  dependency, so they port directly to `react-native-svg` if this ever becomes a
  native mobile app

## Getting started

```bash
npm install
npm run dev       # start the dev server
npm run build      # type-check + production build to dist/
npm run preview    # serve the production build locally
```

## Supabase setup

With `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` set, the app requires
**sign-in** (Supabase email/password auth) and shows the signed-in user's own
rows from `profiles`, `coach_links`, `sessions` and `sets`. Without them it
runs in demo mode on the mock data in `src/data/mockData.ts` (no login).

1. **Env vars** — `cp .env.example .env.local` and fill in both values
   (Project Settings → API). Never use the `service_role` key in the
   front-end. On **Vercel**, add the same two under Project → Settings →
   Environment Variables for Production, then **redeploy** (Vite bakes env
   vars in at build time — a build without them silently falls back to demo
   mode).
2. **Read access** — run `supabase/demo_read_access.sql` (read-only policies).
3. **Sign up** — run `supabase/signup_profiles.sql` (safe to re-run). It adds
   `first_name`, `last_name`, `avatar_url`, `email` to `profiles` and a
   trigger that fills a `profiles` row for every new user — from the Sign up
   form, or from Google (name, picture, email). In Supabase → Authentication
   → URL Configuration set **Site URL** to the Vercel URL and add it (plus
   `http://localhost:5173/` for dev) to **Redirect URLs**.
   (With "Confirm email" off under Authentication → Providers → Email, new
   email users are signed in immediately.)
4. **Google sign-in** — in Google Cloud Console → APIs & Services →
   Credentials, create an **OAuth client ID** (type *Web application*) with
   authorized redirect URI
   `https://<project-ref>.supabase.co/auth/v1/callback`. Paste its client ID
   and secret into Supabase → Authentication → Providers → **Google** and
   enable it. No front-end config is needed.
5. **Demo data (optional)** — `supabase/seed_demo.sql` creates two logins,
   `alex@activatemyo.io` (athlete) and `coach@activatemyo.io` (coach), both
   with password `demo-password-123`, plus sessions/sets.

How the tables map onto the UI (`src/data/supabaseData.ts`):

| UI | Source |
|---|---|
| Profile | signed-in user's `profiles` row (first/last name, picture, email); falls back to Google's `user_metadata` |
| Coach | latest `coach_links` row (athletes: `athlete_id` = me; coaches: `coach_id` = me) + coach's `profiles.name` |
| Session / History / This Week / Today | `sessions` + `sets` of the athlete (coaches see their linked athlete) |
| Session body map | `sessions.muscle_map` (`{"f-bicep-l": "primary" \| 0-100, …}`), else the exercise definition |
| Readiness, live Workout screen, fatigue | not stored yet — mock data |

Auth lives in `src/auth/` (`AuthProvider`, `RequireAuth`, `useAuth()`); the
Sign in / Sign up screen is `src/pages/Login.tsx` (the first screen when
signed out) and Logout is on the Profile screen.

## Pages

| Route       | Screen                                                          |
|-------------|------------------------------------------------------------------|
| `/`         | Today — readiness score, this week's training, muscles worked, daily metrics |
| `/workout`  | Live set view — L/R activation rings, imbalance, set metrics     |
| `/session`  | Post-set/session summary — muscle map for the exercise, performance metrics, coach feedback |
| `/history`  | Past sessions + weekly trends                                    |
| `/coach`    | Coach share code + access management                              |
| `/profile`  | Athlete profile, body metrics, connected devices                  |

## Architecture: hardcoded data today, real sensor data tomorrow

Nothing in this app was built assuming the data is fake — it was built assuming
the data has a **stable shape**, and today that shape happens to be filled in by
hand. This keeps a very small, well-defined seam for plugging in the real
LibEMG → FastAPI → (Supabase) pipeline later, without touching any component or
page.

```
src/data/types.ts       ← TypeScript interfaces: MuscleMap, Session, DaySummary,
                            AthleteProfile, ReadinessSnapshot, etc.
src/data/mockData.ts    ← the ONLY file with hardcoded values. Every export here
                            (ATHLETE, CURRENT_SESSION, WEEK_SUMMARY, EXERCISES, …)
                            conforms to a type from types.ts.
src/lib/muscleMap.ts    ← pure derived-data functions: mergeExercises(),
                            pctToState(), buildMapFromPercentages(). This is the
                            seam where live per-muscle EMG percentages come in.
src/components/*.tsx    ← presentational only. Never construct or fake data —
src/pages/*.tsx           they only import named exports from data/ and lib/.
```

**To swap in real data later:** replace `src/data/mockData.ts` with a version
that exposes the exact same named exports and shapes, but populates them from
your FastAPI/WebSocket hub or Supabase instead of literals (e.g. a `useEffect` +
`useState` hook backed by a WebSocket subscription, or a data-fetching layer that
still resolves to the same constants at import time for the parts that don't
need to be live). Nothing in `components/` or `pages/` needs to change.

## Muscle map

`src/components/BodyMap.tsx` is a faithful port of a hand-built anterior/posterior
muscle diagram (30 named muscle regions, front + back), following the same
primary/secondary/untargeted convention used by fitness apps like Strava's
Muscle Map:

- 🔴 **Primary** — the main muscle(s) targeted by an exercise
- 🟡 **Secondary** — muscles meaningfully engaged as support
- ⚪ **Untargeted** — not significantly activated

`mergeExercises()` in `src/lib/muscleMap.ts` unions multiple exercises for a
day/session view (primary always wins over secondary when merged), matching how
a real EMG-derived activation map would be built from a sequence of sets.

## Design tokens

Dark theme, warm neutral ink on near-black surfaces, with a small accent
palette for scores/intensity:

```
bg #0D1014   surface #161A20   deep #11151A   line #262C35   track #1E232B
ink #ECEAE4  muted #9AA0A8     soft #C4C7CC
accent #7FB8C9   work #D9B26A   max #E07A5F
```

Muscle map palette (light card): primary `#C8202F`, secondary `#F0B429`,
untargeted `#D8D8D8`.

Typeface: **Newsreader** (serif, display/headings) + **Manrope** (sans, body).

## Roadmap

- [ ] Custom LibEMG streamer for the MyoWare 2.0 + ESP32 rig, streaming RMS
      (tension) and MDF (fatigue) over shared memory
- [ ] FastAPI + WebSocket hub broadcasting ~20 updates/sec to the app
- [x] Supabase for session-level history (not raw high-frequency signal)
- [ ] Supabase Auth + athlete/coach linking
- [x] Live data layer (`DataProvider` + `useAppData()`), mock data as fallback
