import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/authContext";
import type { MuscleId } from "../../data/types";
import { supabase } from "../../lib/supabase";
import PassiveBaselineRecorder from "./PassiveBaselineRecorder";
import StrainRecorder from "./StrainRecorder";
import { MUSCLE_PLACEMENTS, SENSORS, type SensorChannel, type SensorPlacements } from "./sensorConfig";

type BaselineChannel = { sample_count: number; median?: number; mad?: number };
type SavedBaseline = {
  channels?: Record<string, BaselineChannel>;
  placements?: Partial<Record<SensorChannel, MuscleId | null>>;
};

const DEFAULT_PLACEMENTS: SensorPlacements = {
  MyoWareSensorL: null,
  MyoWareSensorR: null,
};

export default function Playback() {
  const { user } = useAuth();
  const [placements, setPlacements] = useState<SensorPlacements>(DEFAULT_PLACEMENTS);
  const [baselines, setBaselines] = useState<Partial<Record<SensorChannel, BaselineChannel>>>({});
  const [loadingBaselines, setLoadingBaselines] = useState(true);
  const [baselineError, setBaselineError] = useState<string | null>(null);
  const activeSensors = SENSORS.filter((channel) => placements[channel] !== null);

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
      const saved = row.raw_data as unknown as SavedBaseline;
      if (!saved?.channels || !saved.placements) continue;
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

  const strainBaselines = useMemo(() => {
    const result: Partial<Record<SensorChannel, BaselineChannel>> = {};
    for (const channel of activeSensors) {
      if (baselines[channel]) result[channel] = baselines[channel];
    }
    return result;
  }, [activeSensors, baselines]);
  const readyForStrain = activeSensors.length > 0 && activeSensors.every((channel) => baselines[channel]);

  return (
    <div className="flex-grow flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h1 className="font-serif font-light text-[27px] leading-tight">Recording playback</h1>
        <Link to="/" className="text-sm text-accent">Back</Link>
      </div>
      <p className="text-sm text-muted mb-3">Choose where each sensor is placed. Disabled sensors are ignored.</p>

      <section className="bg-surface rounded-2xl p-3.5 my-2">
        <div className="text-[11px] tracking-wider text-muted uppercase mb-2">Sensor placement</div>
        {SENSORS.map((channel) => (
          <label key={channel} className="block text-sm text-soft mb-3 last:mb-0">
            <span className="block mb-1">{channel}</span>
            <select
              value={placements[channel] ?? "disabled"}
              onChange={(event) => {
                const value = event.target.value;
                setPlacements((current) => ({
                  ...current,
                  [channel]: value === "disabled" ? null : (value as MuscleId),
                }));
              }}
              className="w-full h-10 rounded-lg border border-line bg-bg px-3 text-ink"
            >
              <option value="disabled">Disabled</option>
              {MUSCLE_PLACEMENTS.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
            {placements[channel] !== null && !loadingBaselines && (
              <span className="block text-xs text-muted mt-1">
                {baselines[channel] ? "Baseline available" : "Baseline needed for this placement"}
              </span>
            )}
          </label>
        ))}
        {loadingBaselines && <p className="text-xs text-muted mt-2">Checking saved baselines...</p>}
        {baselineError && <p role="alert" className="text-xs text-max mt-2">Could not check saved baselines: {baselineError}</p>}
        {activeSensors.length === 0 && <p className="text-xs text-muted mt-2">Select a placement for at least one sensor.</p>}
      </section>

      <PassiveBaselineRecorder placements={placements} onSaved={loadBaselines} />
      {!readyForStrain && activeSensors.length > 0 && !loadingBaselines && (
        <p className="text-sm text-muted mt-2">Record a baseline for each enabled sensor at its selected placement before starting strain playback.</p>
      )}
      <StrainRecorder
        placements={placements}
        baselines={strainBaselines}
        canStart={Boolean(readyForStrain) && !loadingBaselines && !baselineError}
      />
    </div>
  );
}
