/**
 * Web-app API for the signed-in user (`Authorization: Bearer <Supabase access token>`).
 *
 *   POST /api/me/connect-code                 → {code, qr, expires_at} one-time code to show as a QR
 *   GET  /api/me/connect-status?code=…         → waiting | connected (+station) | expired
 *   GET  /api/me/station                       → the station I'm connected to (online, sensors, recording)
 *   POST /api/me/command  {type, …}            → start (creates the session) / next_set / finish / cancel
 *   GET  /api/me/live?since=<seq>              → latest live metrics + raw sample batches after seq
 *   GET  /api/me/messages?since=<seq>          → lines typed in the station terminal after seq (Test tab)
 *   POST /api/me/release                       → disconnect (an unfinished workout is discarded)
 */
import { friendlyCode, requireUser, sha256, type AuthUser, type StationRow } from "../_lib/auth.js";
import { check, db } from "../_lib/db.js";
import { actionOf, handle, HttpError, json, num, readJson, str } from "../_lib/http.js";
import { live } from "../_lib/live.js";
import { discardSession, isOnline, queueCommand, releaseIfIdle, releaseStation } from "../_lib/stations.js";

const CODE_TTL_MS = 120_000;

export function GET(req: Request) {
  return handle(async () => {
    const user = await requireUser(req);
    const url = new URL(req.url);
    switch (actionOf(req)) {
      case "connect-status":
        return connectStatus(user, url.searchParams.get("code") ?? "");
      case "station":
        return myStation(user);
      case "live":
        return liveData(user, Number(url.searchParams.get("since") ?? 0) || 0);
      case "messages": {
        const s = await requireConnected(user);
        return json(await live().messages(s.id, Number(url.searchParams.get("since") ?? 0) || 0));
      }
    }
    throw new HttpError(404, "Unknown endpoint");
  });
}

export function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser(req);
    switch (actionOf(req)) {
      case "connect-code":
        return connectCode(user);
      case "command":
        return command(user, await readJson(req));
      case "release": {
        const s = await findStation(user, false);
        if (s) await releaseStation(s, "disconnect");
        return json({ ok: true });
      }
    }
    throw new HttpError(404, "Unknown endpoint");
  });
}

// ---------------------------------------------------------------------------
/** The station this user is connected to (after applying the idle timeout), or null. */
async function findStation(user: AuthUser, markActive = true): Promise<StationRow | null> {
  const row = check(
    await db().from("stations").select("*").eq("current_user_id", user.id).maybeSingle(),
    "find station"
  ) as StationRow | null;
  if (!row) return null;
  const current = await releaseIfIdle(row);
  if (!current.current_user_id) return null;
  // Record activity, but write at most every 30 s (live polling is frequent).
  if (markActive && (!current.last_activity_at || Date.now() - Date.parse(current.last_activity_at) > 30_000)) {
    const now = new Date().toISOString();
    check(await db().from("stations").update({ last_activity_at: now }).eq("id", current.id), "mark activity");
    current.last_activity_at = now;
  }
  return current;
}

async function requireConnected(user: AuthUser): Promise<StationRow> {
  const s = await findStation(user);
  if (!s) throw new HttpError(409, "You're not connected to a station — scan your QR code at the station first");
  return s;
}

async function connectCode(user: AuthUser) {
  // One active code per user.
  check(await db().from("connect_codes").delete().eq("user_id", user.id).is("used_at", null), "clear old codes");
  const code = friendlyCode(10);
  const expires = new Date(Date.now() + CODE_TTL_MS).toISOString();
  check(
    await db().from("connect_codes").insert({ code_hash: sha256(code), user_id: user.id, expires_at: expires }),
    "create code"
  );
  return json({ code, display: `${code.slice(0, 5)}-${code.slice(5)}`, qr: `activatemyo:connect:${code}`, expires_at: expires }, 201);
}

async function connectStatus(user: AuthUser, code: string) {
  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const row = check(
    await db().from("connect_codes").select("*").eq("code_hash", sha256(clean)).eq("user_id", user.id).maybeSingle(),
    "load code"
  ) as { used_at: string | null; expires_at: string; station_id: string | null } | null;
  if (!row) return json({ status: "expired" });
  if (row.used_at && row.station_id) {
    const s = check(await db().from("stations").select("id,name").eq("id", row.station_id).maybeSingle(), "load station") as
      | { id: string; name: string }
      | null;
    return json({ status: "connected", station: s });
  }
  if (Date.parse(row.expires_at) < Date.now()) return json({ status: "expired" });
  return json({ status: "waiting" });
}

async function myStation(user: AuthUser) {
  const s = await findStation(user);
  if (!s) return json({ station: null });
  return json({
    station: {
      id: s.id,
      name: s.name,
      online: isOnline(s),
      sensors: s.sensors ?? {},
      recording_session_id: s.recording_session_id,
      connected_at: s.connected_at,
    },
  });
}

/** Kiril's baseline / strain recordings, run on the station (see labCommand). */
const LAB_MODES = ["baseline", "strain"] as const;

async function command(user: AuthUser, body: Record<string, unknown>) {
  const s = await requireConnected(user);
  const type = body.type;
  if (LAB_MODES.includes(body.mode as (typeof LAB_MODES)[number])) return labCommand(s, body);
  if (type === "start") {
    if (!isOnline(s)) throw new HttpError(409, "The station is offline — is the station program running?");
    if (s.recording_session_id) throw new HttpError(409, "Already recording on this station");
    const exercise = str(body.exercise_name, "exercise_name", 60);
    const muscleMap =
      body.muscle_map && typeof body.muscle_map === "object" && !Array.isArray(body.muscle_map) ? body.muscle_map : null;
    const session = check(
      await db()
        .from("sessions")
        .insert({ athlete_id: user.id, exercise_name: exercise, started_at: new Date().toISOString(), muscle_map: muscleMap })
        .select("id")
        .single(),
      "create session"
    ) as { id: string };
    check(await db().from("stations").update({ recording_session_id: session.id }).eq("id", s.id), "mark recording");
    await queueCommand(s.id, "start", {
      session_id: session.id,
      exercise_name: exercise,
      left_label: typeof body.left_label === "string" ? body.left_label.slice(0, 40) : "Left",
      right_label: typeof body.right_label === "string" ? body.right_label.slice(0, 40) : "Right",
    });
    return json({ ok: true, session_id: session.id });
  }
  if (type === "next_set" || type === "finish") {
    if (!s.recording_session_id) throw new HttpError(409, "Not recording");
    await queueCommand(s.id, type, { session_id: s.recording_session_id });
    return json({ ok: true, session_id: s.recording_session_id });
  }
  if (type === "cancel") {
    if (s.recording_session_id) {
      await queueCommand(s.id, "cancel", { session_id: s.recording_session_id, reason: "user" });
      await discardSession(s.recording_session_id);
      check(await db().from("stations").update({ recording_session_id: null }).eq("id", s.id), "clear recording");
      await live().clear(s.id).catch(() => {});
    }
    return json({ ok: true });
  }
  throw new HttpError(400, "type must be start, next_set, finish or cancel");
}

/**
 * Baseline / strain recording on the station (the Test tab's recording lab).
 * The station records, computes the result like run.py and saves it to
 * emg_recordings for the connected user via /api/station/recording.
 *   start  {mode: "baseline", placements}                   placements: {sensor: muscle id | null}
 *   start  {mode: "strain", channels: [{channel, muscle_id, median, mad}]}
 *   finish {mode} · cancel {mode}
 */
async function labCommand(s: StationRow, body: Record<string, unknown>) {
  const mode = body.mode as (typeof LAB_MODES)[number];
  const type = body.type;
  if (type === "start") {
    if (!isOnline(s)) throw new HttpError(409, "The station is offline — is the station program running?");
    if (s.recording_session_id) throw new HttpError(409, "A workout is being recorded on this station");
    let payload: Record<string, unknown>;
    if (mode === "baseline") {
      const raw = body.placements;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new HttpError(400, "placements must be an object");
      const entries = Object.entries(raw as Record<string, unknown>);
      if (!entries.length || entries.length > 8) throw new HttpError(400, "placements must name 1-8 sensors");
      const placements = Object.fromEntries(
        entries.map(([k, v]) => [str(k, "sensor", 40), v == null ? null : str(v, "muscle id", 40)])
      );
      if (!Object.values(placements).some((v) => v)) throw new HttpError(400, "Choose a placement for at least one sensor");
      payload = { mode, placements };
    } else {
      if (!Array.isArray(body.channels) || !body.channels.length || body.channels.length > 8) {
        throw new HttpError(400, "Select at least one enabled sensor with a saved baseline");
      }
      const channels = body.channels.map((c) => {
        const x = (c ?? {}) as Record<string, unknown>;
        return {
          channel: str(x.channel, "channel", 40),
          muscle_id: str(x.muscle_id, "muscle_id", 40),
          median: num(x.median, "median", -1e9, 1e9),
          mad: num(x.mad ?? 0, "mad", -1e9, 1e9),
        };
      });
      if (new Set(channels.map((c) => c.channel)).size !== channels.length) throw new HttpError(400, "Duplicate sensor selection");
      payload = { mode, channels };
    }
    await queueCommand(s.id, "start", payload);
    return json({ ok: true });
  }
  if (type === "finish" || type === "cancel") {
    await queueCommand(s.id, type, { mode });
    return json({ ok: true });
  }
  throw new HttpError(400, "type must be start, finish or cancel");
}

async function liveData(user: AuthUser, since: number) {
  const s = await requireConnected(user);
  const snap = await live().since(s.id, since);
  return json({ ...snap, recording_session_id: s.recording_session_id, online: isOnline(s), sensors: s.sensors ?? {} });
}
