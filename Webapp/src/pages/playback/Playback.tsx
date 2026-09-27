import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/authContext";
import BodyMap from "../../components/BodyMap";
import type { MuscleId } from "../../data/types";
import { supabase } from "../../lib/supabase";
import PassiveBaselineRecorder from "./PassiveBaselineRecorder";
import { localTransport, type RecorderTransport } from "./recorderTransport";
import StrainRecorder, { type StrainRecording, type StrainResult } from "./StrainRecorder";
import { canonicalChannel, placementLabel, SENSORS, withCanonicalKeys, type SensorChannel, type SensorPlacements } from "./sensorConfig";

type BaselineChannel = { sample_count: number; median?: number; mad?: number };
type SavedBaseline = {
  channels?: Record<string, BaselineChannel>;
  placements?: Partial<Record<SensorChannel, MuscleId | null>>;
};
type SavedStrain = { id: string; created_at: string; raw_data: StrainResult };

function normalizeStrainResult(raw: unknown): StrainResult | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (Array.isArray(value.recordings)) {
    const result = value as unknown as StrainResult;
    return { ...result, recordings: result.recordings.map((r) => ({ ...r, channel: canonicalChannel(r.channel) })) };
  }
  if (typeof value.channel === "string" && Array.isArray(value.readings)) {
    const oldReadings = value.readings as StrainRecording["readings"];
    return {
      recordings: [{
        channel: canonicalChannel(value.channel),
        muscle_id: (typeof value.muscle_id === "string" ? value.muscle_id : "f-pec-r") as StrainRecording["muscle_id"],
        baseline: typeof value.baseline === "number" ? value.baseline : 0,
        duration_s: typeof value.duration_s === "number" ? value.duration_s : 0,
        sample_count: typeof value.sample_count === "number" ? value.sample_count : oldReadings.length,
        readings: oldReadings,
      }],
    };
  }
  return null;
}

const DEFAULT_PLACEMENTS: SensorPlacements = {
  MyoWareSensorL: null,
  MyoWareSensorR: null,
};

/** Kiril's page (Today → "Baseline and strain recordings"): run.py on this computer. */
export default function Playback() {
  return (
    <div className="flex-grow flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h1 className="font-serif font-light text-[27px] leading-tight">Recording playback</h1>
        <Link to="/" className="text-sm text-accent">Back</Link>
      </div>
      <RecordingLab />
    </div>
  );
}

/**
 * Sensor placement, baseline, strain recording and playback. `transport` says
 * how to reach the sensors: run.py on localhost (default) or the QR station.
 */
export function RecordingLab({ transport = localTransport }: { transport?: RecorderTransport }) {
  const { user } = useAuth();
  const [placements, setPlacements] = useState<SensorPlacements>(DEFAULT_PLACEMENTS);
  const [activeSensor, setActiveSensor] = useState<SensorChannel>(SENSORS[0]);
  const [baselines, setBaselines] = useState<Partial<Record<SensorChannel, BaselineChannel>>>({});
  const [loadingBaselines, setLoadingBaselines] = useState(true);
  const [baselineError, setBaselineError] = useState<string | null>(null);
  const [strainHistory, setStrainHistory] = useState<SavedStrain[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [selectedStrain, setSelectedStrain] = useState<SavedStrain | null>(null);
  const activeSensors = SENSORS.filter((channel) => placements[channel] !== null);
  const placementHighlights: Partial<Record<MuscleId, string>> = {};
  if (placements.MyoWareSensorL) placementHighlights[placements.MyoWareSensorL] = "#C8202F";
  if (placements.MyoWareSensorR) placementHighlights[placements.MyoWareSensorR] = "#D49A00";

  const loadBaselines = useCallback(async () => {
    if (!user || !supabase) {
      setBaselines({});
      setLoadingBaselines(false);
      return;
    }
    setLoadingBaselines(true);
    setBaselineError(null);
    const { data, error } = await supabase
      .from("emg_recordings")
      .select("raw_data")
      .eq("user_id", user.id)
      .eq("recording_type", 0);
    if (error) {
      setBaselineError(error.message);
      setBaselines({});
      setLoadingBaselines(false);
      return;
    }

    const latest: Partial<Record<SensorChannel, BaselineChannel>> = {};
    for (const row of data ?? []) {
      const raw = row.raw_data as unknown as SavedBaseline;
      const saved: SavedBaseline = {
        channels: withCanonicalKeys(raw?.channels),
        placements: withCanonicalKeys(raw?.placements) as SavedBaseline["placements"],
      };
      if (!saved.channels || !saved.placements) continue;
      for (const channel of SENSORS) {
        const placement = placements[channel];
        const stats = saved.channels[channel];
        if (
          placement !== null &&
          latest[channel] === undefined &&
          saved.placements[channel] === placement &&
          stats &&
          stats.sample_count > 0 &&
          typeof stats.median === "number"
        ) {
          latest[channel] = stats;
        }
      }
    }
    setBaselines(latest);
    setLoadingBaselines(false);
  }, [user, placements]);

  useEffect(() => {
    void loadBaselines();
  }, [loadBaselines]);

  const loadStrainHistory = useCallback(async () => {
    if (!user || !supabase) {
      setStrainHistory([]);
      setHistoryLoading(false);
      return;
    }
    setHistoryLoading(true);
    setHistoryError(null);
    const { data, error } = await supabase
      .from("emg_recordings")
      .select("id, raw_data, created_at")
      .eq("user_id", user.id)
      .eq("recording_type", 1)
      .order("created_at", { ascending: false });
    if (error) {
      setHistoryError(error.message);
      setStrainHistory([]);
      setHistoryLoading(false);
      return;
    }
    const recordings: SavedStrain[] = [];
    for (const row of data ?? []) {
      const raw = normalizeStrainResult(row.raw_data);
      if (raw) recordings.push({ id: row.id, created_at: row.created_at, raw_data: raw });
    }
    setStrainHistory(recordings);
    setHistoryLoading(false);
  }, [user]);

  useEffect(() => {
    void loadStrainHistory();
  }, [loadStrainHistory]);

  const strainBaselines = useMemo(() => {
    const result: Partial<Record<SensorChannel, BaselineChannel>> = {};
    for (const channel of activeSensors) {
      if (baselines[channel]) result[channel] = baselines[channel];
    }
    return result;
  }, [activeSensors, baselines]);
  const readyForStrain = activeSensors.length > 0 && activeSensors.every((channel) => baselines[channel]);

  return (
    <div className="flex flex-col">
      <p className="text-sm text-muted mb-3">Choose a sensor, then select its muscle on the chart. Disabled sensors are ignored.</p>

      <section className="bg-surface rounded-2xl p-3.5 my-2">
        <div className="text-[11px] tracking-wider text-muted uppercase mb-2">Selected sensor</div>
        <div className="grid grid-cols-2 gap-2">
          {SENSORS.map((channel) => (
            <button
              key={channel}
              type="button"
              onClick={() => setActiveSensor(channel)}
              aria-pressed={activeSensor === channel}
              className={`rounded-xl border p-2 text-left text-xs ${activeSensor === channel ? "border-accent bg-deep text-ink" : "border-line text-soft"}`}
            >
              <span className="block font-semibold">{channel}</span>
              <span className="block mt-1">{placementLabel(placements[channel])}</span>
              {placements[channel] !== null && !loadingBaselines && (
                <span className="block text-muted mt-1">
                  {baselines[channel] ? "Baseline ready" : "Baseline needed"}
                </span>
              )}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setPlacements((current) => ({ ...current, [activeSensor]: null }))}
          className="text-xs text-accent mt-3"
        >
          Disable {activeSensor}
        </button>
        <div className="bg-[#FAFAFA] rounded-xl p-2 mt-3">
          <BodyMap
            muscles={{}}
            highlights={placementHighlights}
            onMuscleClick={(id: MuscleId) => setPlacements((current) => ({ ...current, [activeSensor]: id }))}
            className="w-full h-auto block"
          />
        </div>
        <div className="flex gap-4 text-[11px] text-muted mt-2">
          <span><span className="inline-block w-2 h-2 rounded-full bg-[#C8202F] mr-1" />L sensor</span>
          <span><span className="inline-block w-2 h-2 rounded-full bg-[#D49A00] mr-1" />R sensor</span>
        </div>
        {loadingBaselines && <p className="text-xs text-muted mt-2">Checking saved baselines...</p>}
        {baselineError && <p role="alert" className="text-xs text-max mt-2">Could not check saved baselines: {baselineError}</p>}
        {activeSensors.length === 0 && <p className="text-xs text-muted mt-2">Select a placement for at least one sensor.</p>}
      </section>

      <PassiveBaselineRecorder placements={placements} onSaved={loadBaselines} transport={transport} />
      {!readyForStrain && activeSensors.length > 0 && !loadingBaselines && (
        <p className="text-sm text-muted mt-2">Record a baseline for each enabled sensor at its selected placement before starting strain playback.</p>
      )}
      <StrainRecorder
        placements={placements}
        baselines={strainBaselines}
        canStart={Boolean(readyForStrain) && !loadingBaselines && !baselineError}
        historicalData={selectedStrain?.raw_data ?? null}
        historicalTimestamp={selectedStrain?.created_at ?? null}
        onRecordingStart={() => setSelectedStrain(null)}
        onSaved={() => { void loadStrainHistory(); }}
        transport={transport}
      />

      <section className="bg-surface rounded-2xl p-3.5 my-2">
        <div className="text-[11px] tracking-wider text-muted uppercase mb-2">Past strain recordings</div>
        {historyLoading && <p className="text-xs text-muted">Loading saved recordings...</p>}
        {historyError && <p role="alert" className="text-xs text-max">Could not load recording history: {historyError}</p>}
        {!historyLoading && !historyError && strainHistory.length === 0 && (
          <p className="text-xs text-muted">No saved strain recordings yet.</p>
        )}
        <div className="flex flex-col gap-2">
          {strainHistory.map((recording) => (
            <button
              key={recording.id}
              type="button"
              onClick={() => setSelectedStrain(recording)}
              aria-pressed={selectedStrain?.id === recording.id}
              className={`rounded-xl border p-3 text-left ${selectedStrain?.id === recording.id ? "border-accent bg-deep" : "border-line"}`}
            >
              <span className="block text-sm text-ink">{new Date(recording.created_at).toLocaleString()}</span>
              <span className="block text-xs text-muted mt-1">
                {recording.raw_data.recordings.map((item) => placementLabel(item.muscle_id)).join(" + ")} · {recording.raw_data.recordings.reduce((sum, item) => sum + item.sample_count, 0)} readings
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
