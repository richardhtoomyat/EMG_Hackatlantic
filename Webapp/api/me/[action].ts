/**
 * Web-app API for the signed-in user (`Authorization: Bearer <Supabase access token>`).
 *
 *   POST /api/me/connect-code                 → {code, qr, expires_at} one-time code to show as a QR
 *   GET  /api/me/connect-status?code=…         → waiting | connected (+station) | expired
 *   GET  /api/me/station                       → the station I'm connected to (online, sensors, recording)
 *   POST /api/me/command  {type, …}            → start (creates the session) / next_set / finish / cancel
 *   GET  /api/me/live?since=<seq>              → latest live metrics + raw sample batches after seq
 *   POST /api/me/release                       → disconnect (an unfinished workout is discarded)
 */
import { friendlyCode, requireUser, sha256, type AuthUser, type StationRow } from "../_lib/auth.js";
import { check, db } from "../_lib/db.js";
import { actionOf, handle, HttpError, json, readJson, str } from "../_lib/http.js";
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

async function command(user: AuthUser, body: Record<string, unknown>) {
  const s = await requireConnected(user);
  const type = body.type;
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

async function liveData(user: AuthUser, since: number) {
  const s = await requireConnected(user);
  const snap = await live().since(s.id, since);
  return json({ ...snap, recording_session_id: s.recording_session_id, online: isOnline(s), sensors: s.sensors ?? {} });
}
