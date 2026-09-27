import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/authContext";
import { useAppData, useDataSource, useRefreshData } from "../data/dataContext";
import { setMyRole, type Role } from "../data/roles";

const CHOICES: { role: Role; title: string; text: string; points: string[] }[] = [
  {
    role: "athlete",
    title: "Athlete",
    text: "I train with the sensors.",
    points: ["Record workouts at a sensor station", "Track activation, balance and progress", "Share your training with a coach"],
  },
  {
    role: "coach",
    title: "Coach",
    text: "I follow my athletes' training.",
    points: ["Add athletes with their share code", "See each athlete's workouts and profile", "Switch between athletes"],
  },
];

/**
 * First step after sign-up for anyone who hasn't picked a role yet — Google
 * sign-ups in particular (the email form asks up front). Required, like the
 * body metrics setup that follows for athletes.
 */
export default function ChooseRole() {
  const { user, signOut } = useAuth();
  const { ATHLETE } = useAppData();
  const source = useDataSource();
  const refresh = useRefreshData();
  const navigate = useNavigate();
  const [role, setRole] = useState<Role | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user) return <Navigate to="/login" replace />;
  if (source === "supabase" && ATHLETE.roleSelected !== false) return <Navigate to="/" replace />;

  const onContinue = async () => {
    if (!role) return;
    setBusy(true);
    setError(null);
    try {
      await setMyRole(role);
      await refresh();
      navigate("/", { replace: true }); // athletes then go through body metrics setup
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="max-w-[420px] mx-auto min-h-screen flex flex-col p-6">
      <div className="flex items-center justify-between">
        <div className="font-serif font-light text-xl">
          activate<span className="text-accent font-medium">Myo</span>
        </div>
        <button className="text-sm text-muted" onClick={() => void signOut().then(() => navigate("/login", { replace: true }))}>
          Sign out
        </button>
      </div>

      <div className="mt-10">
        <div className="text-[11px] tracking-wider text-muted uppercase">Welcome{ATHLETE.name ? `, ${ATHLETE.name.split(" ")[0]}` : ""}</div>
        <h1 className="font-serif font-light text-[27px] leading-tight mt-1">How will you use activateMyo?</h1>
        <p className="text-sm text-muted mt-2">Choose one to continue. You can change it later in Profile while no athletes or coaches are linked.</p>
      </div>

      <div className="flex flex-col gap-3 mt-6" role="radiogroup" aria-label="Account type">
        {CHOICES.map((c) => (
          <button
            key={c.role}
            type="button"
            role="radio"
            aria-checked={role === c.role}
            onClick={() => setRole(c.role)}
            className={`text-left rounded-2xl p-4 border transition-colors ${
              role === c.role ? "border-accent bg-surface" : "border-line bg-deep"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="font-serif text-[20px]">{c.title}</div>
              <span className={`w-5 h-5 rounded-full border-2 ${role === c.role ? "border-accent bg-accent" : "border-line"}`} />
            </div>
            <div className="text-sm text-soft mt-0.5">{c.text}</div>
            <ul className="text-xs text-muted mt-2 space-y-1">
              {c.points.map((p) => (
                <li key={p}>· {p}</li>
              ))}
            </ul>
          </button>
        ))}
      </div>

      {error && <div role="alert" className="text-sm text-max mt-3">{error}</div>}
      <button onClick={() => void onContinue()} disabled={!role || busy}
        className="h-12 rounded-full bg-accent text-bg font-semibold mt-6 disabled:opacity-50">
        {busy ? "Saving…" : "Continue"}
      </button>
    </div>
  );
}
