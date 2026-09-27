import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/authContext";
import BodyMetricReminder from "../components/BodyMetricReminder";
import { daysSince } from "../lib/bodyMetrics";
import { useAppData, useDataSource, useRefreshData } from "../data/dataContext";
import { isCoach, setMyRole } from "../data/roles";
import { StationDeviceCard } from "../components/StationStatus";
import { useStationStatus } from "../lib/useStation";

export default function Profile() {
  const { ATHLETE } = useAppData();
  const { enabled, signOut } = useAuth();
  const source = useDataSource();
  const refresh = useRefreshData();
  const navigate = useNavigate();
  const coach = isCoach(ATHLETE.role);
  const station = useStationStatus(source === "supabase" && !coach);
  const [roleMsg, setRoleMsg] = useState<string | null>(null);
  const [roleBusy, setRoleBusy] = useState(false);

  const switchRole = async () => {
    const next = coach ? "athlete" : "coach";
    if (!window.confirm(`Switch this account to ${next}?`)) return;
    setRoleBusy(true);
    setRoleMsg(null);
    try {
      await setMyRole(next);
      await refresh();
    } catch (e) {
      setRoleMsg(e instanceof Error ? e.message : String(e));
    }
    setRoleBusy(false);
  };

  const onLogout = async () => {
    await signOut();
    navigate("/login", { replace: true });
  };
  return (
    <div className="flex-grow flex flex-col">
      <h2 className="font-serif font-light text-[22px]">Profile</h2>

      <div className="bg-surface rounded-2xl p-5 text-center mt-3">
        {ATHLETE.avatarUrl ? (
          <img
            src={ATHLETE.avatarUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="rounded-full mx-auto mb-3 object-cover"
            style={{ width: 60, height: 60 }}
          />
        ) : (
          <div className="rounded-full bg-track mx-auto mb-3" style={{ width: 60, height: 60 }} />
        )}
        <div className="text-lg font-medium">{ATHLETE.name}</div>
        {ATHLETE.email && <div className="text-[13px] text-muted">{ATHLETE.email}</div>}
      </div>

      {source === "supabase" && (
        <>
          <h3 className="text-[15px] font-medium text-soft mt-5 mb-2.5">Account type</h3>
          <div className="bg-surface rounded-2xl p-3.5 flex justify-between items-center gap-3" data-testid="account-type">
            <div>
              <div className="font-medium">{coach ? "Coach" : "Athlete"}</div>
              <div className="text-xs text-muted">
                {coach ? "You follow athletes who share their code with you." : "You record workouts and can share them with a coach."}
              </div>
            </div>
            <button onClick={() => void switchRole()} disabled={roleBusy} className="text-xs text-accent shrink-0 disabled:opacity-50">
              Switch to {coach ? "athlete" : "coach"}
            </button>
          </div>
          {roleMsg && <div role="alert" className="text-xs text-max mt-2">{roleMsg}</div>}
        </>
      )}

      {!coach && (
      <>
      <div className="mt-5">
        <BodyMetricReminder />
      </div>

      <div className="flex justify-between items-center mb-2.5">
        <h3 className="text-[15px] font-medium text-soft">Body Metrics</h3>
        {enabled && (
          <Link to="/body-metrics" className="text-sm text-accent">
            Edit
          </Link>
        )}
      </div>
      <div className="bg-surface rounded-2xl p-3.5 flex flex-col gap-3">
        <Row label="Height" value={ATHLETE.heightLabel} note={updatedNote(ATHLETE.heightUpdatedAt)} />
        <Row label="Weight" value={ATHLETE.weightLabel} note={updatedNote(ATHLETE.weightUpdatedAt)} />
        <Row
          label="Age"
          value={ATHLETE.age ? String(ATHLETE.age) : "—"}
          note={ATHLETE.birthDate ? `Born ${formatDate(ATHLETE.birthDate + "T00:00")}` : undefined}
        />
      </div>

      <h3 className="text-[15px] font-medium text-soft mt-5 mb-2.5">Connected Devices</h3>
      {source === "supabase" ? (
        <StationDeviceCard station={station} />
      ) : (
      <div className="bg-surface rounded-2xl p-3.5 flex justify-between items-center">
        <div>
          <div className="font-medium">MyoWare Sensors</div>
          <div className="text-xs text-muted">2x sensors · Bluetooth</div>
        </div>
        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-deep text-xs">
          <span className={`w-2 h-2 rounded-full ${ATHLETE.sensorsConnected ? "bg-accent" : "bg-muted"}`} />
          {ATHLETE.sensorsConnected ? "Connected" : "Disconnected"}
        </div>
      </div>
      )}
      </>
      )}

      <Link to="/coach" className="flex items-center justify-center h-12 rounded-full border border-line mt-5">
        {ATHLETE.role?.toLowerCase() === "coach" ? "Your athletes" : "Share with Coach"}
      </Link>
      {enabled && (
        <button
          onClick={onLogout}
          className="flex items-center justify-center h-12 rounded-full bg-max text-white mt-2 font-semibold"
        >
          Logout
        </button>
      )}
    </div>
  );
}

function Row({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <div className="text-xs text-muted mb-1">{label}</div>
      <div className="text-sm">
        {value}
        {note && <span className="text-xs text-muted"> · {note}</span>}
      </div>
    </div>
  );
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

function updatedNote(iso: string | null | undefined): string | undefined {
  const days = daysSince(iso);
  if (days === null) return undefined;
  return days === 0 ? "updated today" : days === 1 ? "updated yesterday" : `updated ${days} days ago`;
}
