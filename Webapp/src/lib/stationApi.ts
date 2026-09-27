/**
 * Talks to the shared sensor station through the Vercel API (`/api/me/*`,
 * see api/me/[action].ts). The station PC never talks to the browser directly:
 *
 *   phone ──HTTPS──► Vercel API ──mailbox──► station (EMG/app/src/station.py)
 *   phone ◄─ /api/me/live ◄── Upstash (≈15 s) ◄── station posts live data 5×/s
 *
 * Every request carries the signed-in user's Supabase access token; Vercel
 * checks it and only ever acts for that account.
 */
import { supabase } from "./supabase";

/** API origin: same site by default (Vercel), or VITE_API_URL for `vite dev`. */
const API_BASE = ((import.meta.env.VITE_API_URL as string | undefined) ?? "").replace(/\/+$/, "");

export class StationApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function stationApi<T>(
  action: string,
  opts: { method?: "GET" | "POST"; body?: unknown; query?: Record<string, string | number>; keepalive?: boolean } = {}
): Promise<T> {
  const token = (await supabase?.auth.getSession())?.data.session?.access_token;
  if (!token) throw new StationApiError(401, "Sign in first");
  const qs = opts.query ? `?${new URLSearchParams(Object.entries(opts.query).map(([k, v]) => [k, String(v)]))}` : "";
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/me/${action}${qs}`, {
      method: opts.method ?? (opts.body === undefined ? "GET" : "POST"),
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      keepalive: opts.keepalive,
    });
  } catch {
    throw new StationApiError(0, "Can't reach the server — check your connection");
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new StationApiError(res.status, data.error ?? `Request failed (${res.status})`);
  return data;
}

// --------------------------------------------------------------------- types
export interface StationInfo {
  id: string;
  name: string;
  online: boolean;
  sensors: { left?: boolean; right?: boolean };
  recording_session_id: string | null;
  connected_at: string | null;
}

export interface ConnectCode {
  code: string;
  display: string; // XXXXX-XXXXX
  qr: string; // activatemyo:connect:<code>
  expires_at: string;
}

export type ConnectStatus =
  | { status: "waiting" | "expired" }
  | { status: "connected"; station: { id: string; name: string } | null };

/** Live metrics from the station (recorder.py SessionRecorder.live() + current %). */
export interface LiveMetrics {
  at?: number;
  recording?: boolean;
  left_pct: number | null;
  right_pct: number | null;
  left_avg_pct?: number | null;
  right_avg_pct?: number | null;
  set_number?: number;
  imbalance_pct?: number;
  reps?: number;
  tut_sec?: number;
  peak_pct?: number;
  completed_sets?: number;
}

/** Raw envelope samples: [ms on the station clock, left, right]. */
export type Sample = [number, number | null, number | null];

export interface LiveSnapshot {
  metrics: LiveMetrics | null;
  chunks: { seq: number; samples: Sample[] }[];
  seq: number;
  recording_session_id: string | null;
  online: boolean;
  sensors: { left?: boolean; right?: boolean };
}

/** Disconnect from the station (an unfinished workout is discarded). Used on logout too. */
export const releaseStation = () =>
  stationApi<{ ok: boolean }>("release", { method: "POST", body: {}, keepalive: true });

/** A line typed in the station's terminal (shown on the Test tab; never stored). */
export interface StationMessage {
  seq: number;
  at: number; // ms epoch
  text: string;
}
