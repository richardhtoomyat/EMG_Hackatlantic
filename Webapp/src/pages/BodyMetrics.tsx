import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/authContext";
import { useAppData, useDataSource, useRefreshData } from "../data/dataContext";
import { saveBodyMetrics } from "../data/saveBodyMetrics";
import {
  ageFromBirthDate,
  cmToFtIn,
  ftInToCm,
  kgToLb,
  lbToKg,
  needsBodyMetricsSetup,
} from "../lib/bodyMetrics";

type Units = "metric" | "imperial";
const UNITS_KEY = "activatemyo.units";

function readUnits(): Units {
  try {
    return localStorage.getItem(UNITS_KEY) === "imperial" ? "imperial" : "metric";
  } catch {
    return "metric";
  }
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * Height / weight / date of birth. First-time setup after sign-in (all fields
 * required) or an update, e.g. from a reminder (`?focus=weight|height`).
 */
export default function BodyMetrics() {
  const { user } = useAuth();
  const { ATHLETE } = useAppData();
  const source = useDataSource();
  const refresh = useRefreshData();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const focus = params.get("focus"); // "weight" | "height" | null
  const setup = needsBodyMetricsSetup(ATHLETE);

  const [units, setUnits] = useState<Units>(readUnits);
  const initFtIn = ATHLETE.heightCm ? cmToFtIn(ATHLETE.heightCm) : null;
  const [heightCm, setHeightCm] = useState(ATHLETE.heightCm ? String(ATHLETE.heightCm) : "");
  const [heightFt, setHeightFt] = useState(initFtIn ? String(initFtIn.ft) : "");
  const [heightIn, setHeightIn] = useState(initFtIn ? String(initFtIn.inch) : "");
  const [weight, setWeight] = useState(
    ATHLETE.weightKg ? String(readUnits() === "imperial" ? kgToLb(ATHLETE.weightKg) : ATHLETE.weightKg) : ""
  );
  const [birthDate, setBirthDate] = useState(ATHLETE.birthDate ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (source === "loading") {
    return <div className="min-h-screen bg-bg flex items-center justify-center text-muted text-sm">Loading…</div>;
  }
  if (!user) return <Navigate to="/login" replace />;

  const switchUnits = (u: Units) => {
    if (u === units) return;
    // Convert what's typed so switching never loses input.
    if (u === "imperial") {
      const cm = Number(heightCm);
      if (cm > 0) {
        const { ft, inch } = cmToFtIn(cm);
        setHeightFt(String(ft));
        setHeightIn(String(inch));
      }
      if (Number(weight) > 0) setWeight(String(kgToLb(Number(weight))));
    } else {
      const ft = Number(heightFt) || 0;
      const inch = Number(heightIn) || 0;
      if (ft || inch) setHeightCm(String(ftInToCm(ft, inch)));
      if (Number(weight) > 0) setWeight(String(lbToKg(Number(weight))));
    }
    setUnits(u);
    try {
      localStorage.setItem(UNITS_KEY, u);
    } catch {
      /* per-viewer convenience only */
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const cm = units === "metric" ? Number(heightCm) : ftInToCm(Number(heightFt) || 0, Number(heightIn) || 0);
    const kg = units === "metric" ? Number(weight) : lbToKg(Number(weight));
    if (!(cm >= 90 && cm <= 250)) return setError("Enter a height between 90 and 250 cm (2'11\" – 8'2\").");
    if (!(kg >= 25 && kg <= 300)) return setError("Enter a weight between 25 and 300 kg (55 – 660 lb).");
    if (!birthDate || birthDate > today() || birthDate < "1900-01-01") return setError("Enter your date of birth.");
    if (ageFromBirthDate(birthDate) < 5) return setError("Date of birth looks too recent.");

    // Only stamp what the user actually entered, so the other reminder isn't reset by accident.
    const heightChanged = Math.abs(cm - (ATHLETE.heightCm ?? 0)) >= 0.5;
    const weightChanged = Math.abs(kg - (ATHLETE.weightKg ?? 0)) >= 0.1;
    setBusy(true);
    setError(null);
    try {
      await saveBodyMetrics(user.id, {
        heightCm: setup || heightChanged || focus === "height" ? cm : undefined,
        weightKg: setup || weightChanged || focus === "weight" ? kg : undefined,
        birthDate: birthDate !== ATHLETE.birthDate ? birthDate : undefined,
      });
      await refresh();
      navigate(setup ? "/" : focus ? "/" : "/profile", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : (err as { message?: string })?.message ?? String(err));
      setBusy(false);
    }
  };

  const input =
    "h-12 w-full rounded-xl bg-surface border border-line px-4 text-ink placeholder:text-muted focus:outline-none focus:border-accent";
  const unitTab = (u: Units) =>
    `flex-1 h-9 rounded-full text-sm ${units === u ? "bg-surface text-ink" : "text-muted"}`;
  const firstName = ATHLETE.name.split(" ")[0];
  const age = birthDate && birthDate <= today() ? ageFromBirthDate(birthDate) : null;

  return (
    <div className="max-w-[420px] mx-auto bg-bg min-h-screen flex flex-col p-6">
      <div className="flex items-center justify-between">
        <div className="font-serif font-light text-xl">
          activate<span className="text-accent font-medium">Myo</span>
        </div>
        {!setup && (
          <Link to={focus ? "/" : "/profile"} className="text-sm text-muted">
            Cancel
          </Link>
        )}
      </div>

      <h1 className="font-serif font-light text-[27px] leading-tight mt-8">
        {setup ? `Welcome, ${firstName}` : focus === "weight" ? "Time for a weigh-in" : focus === "height" ? "Update your height" : "Body metrics"}
      </h1>
      <p className="text-sm text-muted mt-1">
        {setup
          ? "A few details so activation scores and trends are measured against you."
          : focus === "weight"
            ? "It's been a while — enter today's weight to keep your trends accurate."
            : focus === "height"
              ? "You may still be growing — update your height once a year."
              : "Update your height, weight or date of birth."}
      </p>

      <div className="flex gap-1 p-1 rounded-full bg-deep border border-line mt-6" role="group" aria-label="Units">
        <button type="button" className={unitTab("metric")} aria-pressed={units === "metric"} onClick={() => switchUnits("metric")}>
          Metric (cm, kg)
        </button>
        <button type="button" className={unitTab("imperial")} aria-pressed={units === "imperial"} onClick={() => switchUnits("imperial")}>
          Imperial (ft, lb)
        </button>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-3 mt-5" noValidate>
        <label className="text-xs text-muted" htmlFor={units === "metric" ? "heightCm" : "heightFt"}>Height</label>
        {units === "metric" ? (
          <div className="relative">
            <input id="heightCm" inputMode="decimal" className={input} placeholder="178" autoFocus={focus === "height"}
              value={heightCm} onChange={(e) => setHeightCm(e.target.value)} />
            <span className="absolute right-4 top-3.5 text-sm text-muted">cm</span>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <div className="relative">
              <input id="heightFt" inputMode="numeric" className={input} placeholder="5" autoFocus={focus === "height"}
                value={heightFt} onChange={(e) => setHeightFt(e.target.value)} />
              <span className="absolute right-4 top-3.5 text-sm text-muted">ft</span>
            </div>
            <div className="relative">
              <input id="heightIn" inputMode="numeric" className={input} placeholder="10" aria-label="Height inches"
                value={heightIn} onChange={(e) => setHeightIn(e.target.value)} />
              <span className="absolute right-4 top-3.5 text-sm text-muted">in</span>
            </div>
          </div>
        )}

        <label className="text-xs text-muted mt-1" htmlFor="weight">Weight</label>
        <div className="relative">
          <input id="weight" inputMode="decimal" className={input} placeholder={units === "metric" ? "79" : "175"}
            autoFocus={focus === "weight"} value={weight} onChange={(e) => setWeight(e.target.value)} />
          <span className="absolute right-4 top-3.5 text-sm text-muted">{units === "metric" ? "kg" : "lb"}</span>
        </div>

        <label className="text-xs text-muted mt-1" htmlFor="birthDate">Date of birth</label>
        <input id="birthDate" type="date" min="1900-01-01" max={today()} className={`${input} [color-scheme:dark]`}
          value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
        {age !== null && age >= 0 && <span className="text-[11px] text-muted">Age {age} — updates automatically on your birthday</span>}

        {error && <div role="alert" className="text-sm text-max mt-1">{error}</div>}

        <button type="submit" disabled={busy}
          className="h-12 rounded-full bg-accent text-bg font-semibold mt-4 disabled:opacity-60">
          {busy ? "Saving…" : setup ? "Continue" : "Save"}
        </button>
      </form>
    </div>
  );
}
