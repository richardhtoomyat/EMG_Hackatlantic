/**
 * Station (PC + sensors) API. Every call except `register` needs
 * `Authorization: Station <station id>.<secret>`.
 *
 *   POST /api/station/register   {name}            → {station_id, station_key}
 *   POST /api/station/heartbeat  {sensors}         → status (who is connected, recording)
 *   POST /api/station/claim      {code}            → a user's QR code: connect that user
 *   GET  /api/station/commands                     → long-poll (≤ 8 s) for start/next_set/finish/cancel
 *   POST /api/station/live       {metrics, samples} → live data for the phone (not stored)
 *   POST /api/station/set        {session_id, set}  → save one set for the connected user
 *   POST /api/station/finish     {session_id, ended_at, activation_score, sets}
 *   POST /api/station/message    {text}             → a line typed in the station terminal (phone's Test tab; not stored)
 *   POST /api/station/profile    {age | weight_kg}  → test write: one profile column of the connected user
 *   POST /api/station/recording  {type, raw_data}   → a baseline (0) / strain (1) recording → emg_recordings
 *   POST /api/station/release                      → "End session" pressed on the station
 */
import { requireStation, secret, sha256, userName, type StationRow } from "../_lib/auth.js";
import { check, db } from "../_lib/db.js";
import { actionOf, handle, HttpError, json, musclePct, num, readJson, sleep, str } from "../_lib/http.js";
import { live, type LiveChunk } from "../_lib/live.js";
import { releaseIfIdle, releaseStation, upsertSet, type SetPayload } from "../_lib/stations.js";

const LONG_POLL_MS = 8_000;
const POLL_EVERY_MS = 300;

export function GET(req: Request) {
  return handle(async () => {
    if (actionOf(req) === "commands") return commands(await requireStation(req));
    throw new HttpError(404, "Unknown station endpoint");
  });
}

export function POST(req: Request) {
  return handle(async () => {
    const action = actionOf(req);
    if (action === "register") return register(req);
    const station = await requireStation(req);
    switch (action) {
      case "heartbeat":
        return heartbeat(station, await readJson(req));
      case "claim":
        return claim(station, await readJson(req));
      case "live":
        return liveData(station, await readJson(req));
      case "message":
        return message(station, await readJson(req));
      case "profile":
        return profile(station, await readJson(req));
      case "recording":
        return saveRecording(station, await readJson(req));
      case "set":
        return saveSet(station, await readJson(req));
      case "finish":
        return finish(station, await readJson(req));
      case "release":
        await releaseStation(station, "station");
        return json({ status: "available" });
    }
    throw new HttpError(404, "Unknown station endpoint");
  });
}

// ---------------------------------------------------------------------------
async function register(req: Request) {
  const body = await readJson<{ name?: unknown }>(req);
  const name = str(body.name ?? "Station", "name", 60);
  const key = secret();
  const row = check(
    await db().from("stations").insert({ name, key_hash: sha256(key) }).select("id,name").single(),
    "register station"
  ) as { id: string; name: string };
  return json({ station_id: row.id, name: row.name, station_key: `${row.id}.${key}` }, 201);
}

async function statusOf(station: StationRow) {
  return {
    status: station.current_user_id ? "in_use" : "available",
    user_name: station.current_user_id ? await userName(station.current_user_id) : null,
    recording_session_id: station.recording_session_id,
  };
}

async function touch(station: StationRow, extra: Record<string, unknown> = {}): Promise<StationRow> {
  return check(
    await db()
      .from("stations")
      .update({ last_seen_at: new Date().toISOString(), ...extra })
      .eq("id", station.id)
      .select("*")
      .single(),
    "update station"
  ) as StationRow;
}

async function heartbeat(station: StationRow, body: { sensors?: unknown }) {
  const s = body.sensors && typeof body.sensors === "object" ? (body.sensors as Record<string, unknown>) : {};
  const sensors = { left: s.left === true, right: s.right === true };
  const updated = await releaseIfIdle(await touch(station, { sensors }));
  return json(await statusOf(updated));
}

async function claim(station: StationRow, body: { code?: unknown }) {
  const code = str(body.code, "code", 64).toUpperCase().replace(/^ACTIVATEMYO:CONNECT:/, "").replace(/[^A-Z0-9]/g, "");
  const found = check(
    await db().from("connect_codes").select("*").eq("code_hash", sha256(code)).maybeSingle(),
    "find code"
  ) as { user_id: string; expires_at: string; used_at: string | null } | null;
  if (!found || found.used_at || Date.parse(found.expires_at) < Date.now()) {
    throw new HttpError(400, "That code is invalid or has expired — make a new one on your phone");
  }
  const current = await releaseIfIdle(station);
  if (current.current_user_id && current.current_user_id !== found.user_id) {
    throw new HttpError(409, "This station is in use by another user");
  }
  const elsewhere = check(
    await db().from("stations").select("id,name").eq("current_user_id", found.user_id).neq("id", station.id),
    "check other stations"
  ) as { id: string; name: string }[];
  if (elsewhere.length) throw new HttpError(409, `You're already connected to ${elsewhere[0].name} — disconnect there first`);

  // Mark the code used only if still unused (a code works once).
  const used = check(
    await db()
      .from("connect_codes")
      .update({ used_at: new Date().toISOString(), station_id: station.id })
      .eq("code_hash", sha256(code))
      .is("used_at", null)
      .select("code_hash"),
    "use code"
  ) as unknown[];
  if (!used.length) throw new HttpError(400, "That code was already used");

  const now = new Date().toISOString();
  await live().clearMessages(station.id).catch(() => {}); // a new connection starts with an empty Test tab
  await touch(current, { current_user_id: found.user_id, connected_at: now, last_activity_at: now });
  return json({ status: "in_use", user_name: await userName(found.user_id) });
}

async function commands(station: StationRow) {
  let s = await releaseIfIdle(await touch(station));
  const connectedUser = s.current_user_id;
  const deadline = Date.now() + LONG_POLL_MS;
  for (;;) {
    const next = check(
      await db()
        .from("station_commands")
        .select("id,type,payload")
        .eq("station_id", s.id)
        .is("delivered_at", null)
        .order("id")
        .limit(1)
        .maybeSingle(),
      "read mailbox"
    ) as { id: number; type: string; payload: Record<string, unknown> } | null;
    if (next) {
      const taken = check(
        await db()
          .from("station_commands")
          .update({ delivered_at: new Date().toISOString() })
          .eq("id", next.id)
          .is("delivered_at", null)
          .select("id"),
        "take command"
      ) as unknown[];
      if (taken.length) return json({ command: { type: next.type, ...next.payload }, ...(await statusOf(s)) });
    }
    // Also return early when someone connects or disconnects, so the station knows at once.
    if (Date.now() > deadline || s.current_user_id !== connectedUser) return json({ command: null, ...(await statusOf(s)) });
    await sleep(POLL_EVERY_MS);
    s = (check(await db().from("stations").select("*").eq("id", s.id).single(), "reload station") as StationRow);
  }
}

async function liveData(station: StationRow, body: { metrics?: unknown; samples?: unknown }) {
  if (!station.current_user_id) return json({ ok: false, status: "available" });
  const metrics = body.metrics && typeof body.metrics === "object" ? (body.metrics as Record<string, unknown>) : {};
  const raw = Array.isArray(body.samples) ? body.samples.slice(0, 2000) : [];
  const samples = raw
    .filter((r): r is unknown[] => Array.isArray(r) && r.length >= 3)
    .map((r) => [Number(r[0]) || 0, r[1] == null ? null : Number(r[1]), r[2] == null ? null : Number(r[2])]) as LiveChunk["samples"];
  const seq = await live().push(station.id, { ...metrics, at: Date.now() }, samples);
  return json({ ok: true, seq });
}

async function message(station: StationRow, body: { text?: unknown }) {
  if (!station.current_user_id) throw new HttpError(409, "Nobody is connected to this station");
  const text = str(body.text, "text", 500);
  const seq = await live().pushMessage(station.id, text);
  return json({ ok: true, seq });
}

/**
 * Test writes from the station terminal (`/age 25`, `/weight 72.5`): fixed
 * updates of single profile columns, only for the user connected to this station.
 */
const PROFILE_FIELDS = {
  age: { min: 5, max: 120, decimals: 0, stamp: null },
  weight_kg: { min: 20, max: 300, decimals: 1, stamp: "weight_updated_at" }, // same as the app's weight form
} as const;

async function profile(station: StationRow, body: Record<string, unknown>) {
  if (!station.current_user_id) throw new HttpError(409, "Nobody is connected to this station");
  const field = Object.keys(PROFILE_FIELDS).find((k) => body[k] !== undefined) as keyof typeof PROFILE_FIELDS | undefined;
  if (!field) throw new HttpError(400, `Send one of: ${Object.keys(PROFILE_FIELDS).join(", ")}`);
  const spec = PROFILE_FIELDS[field];
  const f = 10 ** spec.decimals;
  const value = Math.round(num(body[field], field, spec.min, spec.max) * f) / f;
  const before = check(
    await db().from("profiles").select(field).eq("id", station.current_user_id).maybeSingle(),
    "read profile"
  ) as Record<string, number | null> | null;
  if (!before) throw new HttpError(404, "The connected user has no profile row");
  const patch: Record<string, unknown> = { [field]: value };
  if (spec.stamp) patch[spec.stamp] = new Date().toISOString();
  const after = check(
    await db().from("profiles").update(patch).eq("id", station.current_user_id).select(field).single(),
    "update profile"
  ) as Record<string, number | null>;
  const n = (v: number | null | undefined) => (v == null ? null : Number(v));
  return json({
    ok: true,
    field,
    user_name: await userName(station.current_user_id),
    before: n(before[field]),
    after: n(after[field]),
  });
}

/**
 * Kiril's baseline (type 0) / strain (type 1) recordings, computed on the
 * station (EMG/app/src/lab.py), saved for the connected user
 * (the Playback / Test tab code reads them back).
 */
const MAX_RECORDING_BYTES = 3_500_000; // Vercel's request limit is 4.5 MB

async function saveRecording(station: StationRow, body: { type?: unknown; raw_data?: unknown }) {
  if (!station.current_user_id) throw new HttpError(409, "Nobody is connected to this station");
  const type = body.type;
  if (type !== 0 && type !== 1) throw new HttpError(400, "type must be 0 (baseline) or 1 (strain)");
  const data = body.raw_data;
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new HttpError(400, "raw_data must be an object");
  const d = data as Record<string, unknown>;
  if (type === 0 && (typeof d.channels !== "object" || typeof d.placements !== "object")) {
    throw new HttpError(400, "A baseline needs channels and placements");
  }
  if (type === 1 && (!Array.isArray(d.recordings) || d.recordings.length > 8)) {
    throw new HttpError(400, "A strain recording needs 1-8 recordings");
  }
  if (JSON.stringify(d).length > MAX_RECORDING_BYTES) throw new HttpError(413, "Recording too large — record for a shorter time");
  const row = check(
    await db()
      .from("emg_recordings")
      .insert({ user_id: station.current_user_id, recording_type: type, raw_data: d })
      .select("id")
      .single(),
    "save recording"
  ) as { id: string };
  return json({ ok: true, id: row.id });
}

/** The station may only save into the session it is recording, for the user connected to it. */
async function assertRecording(station: StationRow, sessionId: unknown) {
  if (!station.current_user_id || !station.recording_session_id || sessionId !== station.recording_session_id) {
    throw new HttpError(409, "No matching recording on this station (it may have been cancelled)");
  }
  const session = check(
    await db().from("sessions").select("id,athlete_id").eq("id", station.recording_session_id).maybeSingle(),
    "load session"
  ) as { id: string; athlete_id: string } | null;
  if (!session || session.athlete_id !== station.current_user_id) throw new HttpError(409, "Session does not belong to the connected user");
  return session;
}

function parseSet(v: unknown): SetPayload {
  const s = (v ?? {}) as Record<string, unknown>;
  return {
    set_number: Math.round(num(s.set_number, "set_number", 1, 100)),
    reps: Math.round(num(s.reps, "reps", 0, 1000)),
    time_under_tension_sec: Math.round(num(s.time_under_tension_sec, "time_under_tension_sec", 0, 36000)),
    peak_activation_pct: Math.round(num(s.peak_activation_pct, "peak_activation_pct", 0, 100)),
    contraction_pct: Math.round(num(s.contraction_pct, "contraction_pct", 0, 100)),
    recovery_sec: Math.round(num(s.recovery_sec ?? 0, "recovery_sec", 0, 36000)),
    muscle_pct: musclePct(s.muscle_pct),
  };
}

async function saveSet(station: StationRow, body: { session_id?: unknown; set?: unknown }) {
  const session = await assertRecording(station, body.session_id);
  await upsertSet(session.id, parseSet(body.set));
  return json({ ok: true });
}

async function finish(
  station: StationRow,
  body: { session_id?: unknown; ended_at?: unknown; activation_score?: unknown; sets?: unknown }
) {
  const session = await assertRecording(station, body.session_id);
  const sets = Array.isArray(body.sets) ? body.sets.slice(0, 100).map(parseSet) : [];
  for (const s of sets) await upsertSet(session.id, s);
  const endedAt = typeof body.ended_at === "string" && !Number.isNaN(Date.parse(body.ended_at)) ? body.ended_at : new Date().toISOString();
  check(
    await db()
      .from("sessions")
      .update({ ended_at: endedAt, activation_score: Math.round(num(body.activation_score ?? 0, "activation_score", 0, 100)) })
      .eq("id", session.id),
    "finish session"
  );
  await touch(station, { recording_session_id: null });
  await live().clear(station.id).catch(() => {});
  return json({ ok: true, session_id: session.id });
}
