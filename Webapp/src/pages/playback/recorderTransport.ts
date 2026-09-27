/**
 * How the baseline / strain recorders reach the sensors:
 *   localTransport   — run.py on this computer (http://localhost:5000); the browser saves the result.
 *   stationTransport — the QR-connected station (via /api/me/command); the station
 *                      computes the result and Vercel saves it to emg_recordings,
 *                      so here we only wait for that row to appear.
 */
import { stationApi } from "../../lib/stationApi";
import { supabase } from "../../lib/supabase";
import type { MuscleId } from "../../data/types";
import type { SensorPlacements } from "./sensorConfig";
import type { StrainResult } from "./StrainRecorder";

export type PassiveSummary = {
  sample_count: number;
  duration_s: number;
  channels: Record<string, { sample_count: number; median?: number; mad?: number }>;
};

/** A sensor to record strain on, with its saved baseline. */
export type StrainChannel = {
  channel: string;
  muscle_id: MuscleId;
  baseline: { sample_count: number; median?: number; mad?: number };
};

export interface RecorderTransport {
  kind: "local" | "station";
  startBaseline(placements: SensorPlacements): Promise<void>;
  /** saved = the recording is already in Supabase (station); otherwise the caller uploads it. */
  stopBaseline(): Promise<{ summary: PassiveSummary; saved: boolean }>;
  startStrain(channels: StrainChannel[]): Promise<void>;
  stopStrain(): Promise<{ result: StrainResult; saved: boolean }>;
}

// ---------------------------------------------------------------- run.py
async function post<T>(path: string, body?: unknown, fallback = "Request failed"): Promise<T> {
  const response = await fetch(`http://localhost:5000/${path}`, {
    method: "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? fallback);
  return result as T;
}

export const localTransport: RecorderTransport = {
  kind: "local",
  startBaseline: async () => void (await post("start_passive", undefined, "Recording request failed")),
  stopBaseline: async () => ({ summary: await post<PassiveSummary>("end_passive", undefined, "Could not stop recording"), saved: false }),
  startStrain: async (channels) => void (await post("start_strain", { channels }, "Could not start strain recording")),
  stopStrain: async () => ({ result: await post<StrainResult>("end_strain", undefined, "Could not stop strain recording"), saved: false }),
};

// ---------------------------------------------------------------- station
const SAVE_TIMEOUT_MS = 30_000;

async function latestRecording(userId: string, type: 0 | 1): Promise<{ id: string; raw_data: unknown } | null> {
  if (!supabase) throw new Error("Supabase is not configured");
  const { data, error } = await supabase
    .from("emg_recordings")
    .select("id, raw_data")
    .eq("user_id", userId)
    .eq("recording_type", type)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  return data?.[0] ?? null;
}

/** Tells the station to finish, then waits for the row it saves. */
async function finishAndWait(userId: string, mode: "baseline" | "strain", type: 0 | 1): Promise<unknown> {
  const before = (await latestRecording(userId, type))?.id ?? null;
  await stationApi("command", { body: { type: "finish", mode } });
  const deadline = Date.now() + SAVE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 700));
    const latest = await latestRecording(userId, type);
    if (latest && latest.id !== before) return latest.raw_data;
  }
  throw new Error("The station didn't save the recording — check the station's terminal and the log above.");
}

export function stationTransport(userId: string): RecorderTransport {
  return {
    kind: "station",
    startBaseline: async (placements) =>
      void (await stationApi("command", { body: { type: "start", mode: "baseline", placements } })),
    stopBaseline: async () => {
      const raw = (await finishAndWait(userId, "baseline", 0)) as PassiveSummary;
      return { summary: raw, saved: true };
    },
    startStrain: async (channels) =>
      void (await stationApi("command", {
        body: {
          type: "start",
          mode: "strain",
          channels: channels.map((c) => ({
            channel: c.channel,
            muscle_id: c.muscle_id,
            median: c.baseline.median,
            mad: c.baseline.mad ?? 0,
          })),
        },
      })),
    stopStrain: async () => ({ result: (await finishAndWait(userId, "strain", 1)) as StrainResult, saved: true }),
  };
}
