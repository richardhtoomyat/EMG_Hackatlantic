import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { check, db } from "./db.js";
import { HttpError } from "./http.js";

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Random URL-safe secret. */
export const secret = (bytes = 32) => randomBytes(bytes).toString("base64url");

/** Human-friendly code from an alphabet without look-alikes (0/O, 1/I/L). */
export function friendlyCode(length = 10): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(length);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export interface AuthUser {
  id: string;
  email: string | null;
}

/** The signed-in web-app user: `Authorization: Bearer <Supabase access token>`, verified with Supabase. */
export async function requireUser(req: Request): Promise<AuthUser> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Sign in first");
  const { data, error } = await db().auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Your session has expired — sign in again");
  return { id: data.user.id, email: data.user.email ?? null };
}

export interface StationRow {
  id: string;
  name: string;
  key_hash: string;
  last_seen_at: string | null;
  sensors: Record<string, boolean>;
  current_user_id: string | null;
  connected_at: string | null;
  last_activity_at: string | null;
  recording_session_id: string | null;
}

/** The station PC: `Authorization: Station <station id>.<secret>`. */
export async function requireStation(req: Request): Promise<StationRow> {
  const raw = (req.headers.get("authorization") ?? "").replace(/^Station\s+/i, "");
  const dot = raw.indexOf(".");
  const id = raw.slice(0, dot);
  const key = raw.slice(dot + 1);
  if (dot < 1 || !key || !/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(401, "Missing or malformed station key");
  const row = check(await db().from("stations").select("*").eq("id", id).maybeSingle(), "load station") as StationRow | null;
  const expected = Buffer.from(row?.key_hash ?? "0".repeat(64), "hex");
  const actual = Buffer.from(sha256(key), "hex");
  if (!row || expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new HttpError(401, "Unknown station or wrong station key — run station setup again");
  }
  return row;
}

/** Display name for a user id (profiles.first_name/last_name/name). */
export async function userName(userId: string): Promise<string> {
  const p = check(await db().from("profiles").select("*").eq("id", userId).maybeSingle(), "load profile") as Record<
    string,
    string | null
  > | null;
  const full = [p?.first_name, p?.last_name].filter(Boolean).join(" ");
  return full || p?.name || "Athlete";
}
