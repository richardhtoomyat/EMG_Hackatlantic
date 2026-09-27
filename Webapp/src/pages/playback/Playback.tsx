import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/authContext";
import BodyMap from "../../components/BodyMap";
import type { MuscleId } from "../../data/types";
import { supabase } from "../../lib/supabase";
import PassiveBaselineRecorder from "./PassiveBaselineRecorder";
import StrainRecorder from "./StrainRecorder";
import { placementLabel, SENSORS, type SensorChannel, type SensorPlacements } from "./sensorConfig";

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
  const [activeSensor, setActiveSensor] = useState<SensorChannel>(SENSORS[0]);
  const [baselines, setBaselines] = useState<Partial<Record<SensorChannel, BaselineChannel>>>({});
  const [loadingBaselines, setLoadingBaselines] = useState(true);
  const [baselineError, setBaselineError] = useState<string | null>(null);
  const activeSensors = SENSORS.filter((channel) => placements[channel] !== null);
  const placementHighlights: Partial<Record<MuscleId, string>> = {};
  if (placements.MyoWareSensorL) placementHighlights[placements.MyoWareSensorL] = "#C8202F";
  if (placements.MyLocalWareSensorR) placementHighlights[placements.MyLocalWareSensorR] = "#D49A00";

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
