import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/authContext";
import {
  claimShareCode,
  createShareCode,
  getActiveShareCode,
  listLinked,
  removeLink,
  setViewedAthlete,
  type LinkedPerson,
  type ShareCode,
} from "../data/coachSharing";
import { useAppData, useRefreshData } from "../data/dataContext";

export default function Coach() {
  const { enabled, user } = useAuth();
  const { ATHLETE } = useAppData();
  if (!enabled || !user) return <DemoCoach />;
  return ATHLETE.role?.toLowerCase() === "coach" ? <CoachView userId={user.id} /> : <AthleteView userId={user.id} />;
}

const errorText = (e: unknown) => (e as { message?: string })?.message ?? String(e);
const since = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";

/** Loads the people linked to this user and exposes a reload. */
function useLinked(userId: string, asCoach: boolean) {
  const [people, setPeople] = useState<LinkedPerson[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setPeople(await listLinked(userId, asCoach));
      setError(null);
    } catch (e) {
      setError(errorText(e));
      setPeople([]);
    }
  }, [userId, asCoach]);
  useEffect(() => {
    let cancelled = false;
    listLinked(userId, asCoach).then(
      (p) => !cancelled && setPeople(p),
      (e) => {
        if (cancelled) return;
        setError(errorText(e));
        setPeople([]);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [userId, asCoach]);
  return { people, error, reload };
}

// ------------------------------------------------------------------ athlete
function AthleteView({ userId }: { userId: string }) {
  const refresh = useRefreshData();
  const { people, error, reload } = useLinked(userId, false);
  const [code, setCode] = useState<ShareCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    getActiveShareCode().then(setCode, (e) => setMsg(errorText(e)));
  }, []);

  const generate = async () => {
    setBusy(true);
    setMsg(null);
    try {
      setCode(await createShareCode());
      setCopied(false);
    } catch (e) {
      setMsg(errorText(e));
    }
    setBusy(false);
  };

  const remove = async (p: LinkedPerson) => {
    if (!window.confirm(`Remove ${p.name}'s access to your training?`)) return;
    try {
      await removeLink(p.linkId);
      await Promise.all([reload(), refresh()]);
    } catch (e) {
      setMsg(errorText(e));
    }
  };

  return (
    <div className="flex-grow flex flex-col">
      <h2 className="font-serif font-light text-[22px]">Coach Access</h2>
      <p className="text-sm text-muted mt-1">Give a coach a code so they can follow your training.</p>

      <div className="text-[11px] tracking-wider text-muted uppercase mt-5 mb-3">Share Code</div>
      <div className="bg-deep rounded-2xl p-5 text-center">
        {code ? (
          <>
            <div className="font-mono text-[34px] tracking-[6px] font-semibold text-accent my-2" data-testid="share-code">
              {code.code}
            </div>
            <div className="text-xs text-muted">
              Single use · expires {new Date(code.expiresAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            </div>
            <div className="flex gap-2 justify-center mt-3">
              <button
                className="h-11 px-4 rounded-full border border-line"
                onClick={() => navigator.clipboard?.writeText(code.code).then(() => setCopied(true), () => {})}
              >
                {copied ? "Copied" : "📋 Copy code"}
              </button>
              <button className="h-11 px-4 rounded-full text-muted text-sm" onClick={generate} disabled={busy}>
                New code
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="text-sm text-muted my-2">Your coach enters this code on their Coach screen.</div>
            <button onClick={generate} disabled={busy}
              className="mt-2 h-11 px-5 rounded-full bg-accent text-bg font-semibold disabled:opacity-60">
              {busy ? "Creating…" : "Generate share code"}
            </button>
          </>
        )}
      </div>

      <h3 className="text-[15px] font-medium text-soft mt-5 mb-2.5">Coaches with Access</h3>
      <PeopleList
        people={people}
        empty="No coach linked yet."
        render={(p) => (
          <button className="text-xs text-max" onClick={() => void remove(p)}>Remove access</button>
        )}
      />

      <h3 className="text-[15px] font-medium text-soft mt-5 mb-2.5">What They Can See</h3>
      <div className="bg-deep rounded-2xl px-3.5">
        <div className="py-2 border-b border-track">✓ Your workouts, sets and history</div>
        <div className="py-2 border-b border-track">✓ All metrics &amp; muscle map</div>
        <div className="py-2">✓ Your profile (name, height, weight, age)</div>
      </div>

      {(msg || error) && <div role="alert" className="text-sm text-max mt-3">{msg || error}</div>}
    </div>
  );
}

// -------------------------------------------------------------------- coach
function CoachView({ userId }: { userId: string }) {
  const refresh = useRefreshData();
  const navigate = useNavigate();
  const { VIEWING } = useAppData();
  const { people, error, reload } = useLinked(userId, true);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const view = async (athleteId: string, go = true) => {
    setViewedAthlete(athleteId);
    await refresh();
    if (go) navigate("/");
  };

  const onAdd = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const { athleteId, athleteName } = await claimShareCode(value);
      setValue("");
      await reload();
      await view(athleteId, false);
      setMsg({ ok: true, text: `Linked to ${athleteName}. You're now viewing their training.` });
    } catch (err) {
      setMsg({ ok: false, text: errorText(err) });
    }
    setBusy(false);
  };

  const remove = async (p: LinkedPerson) => {
    if (!window.confirm(`Stop following ${p.name}?`)) return;
    try {
      await removeLink(p.linkId);
      if (VIEWING?.athleteId === p.personId) setViewedAthlete(null);
      await Promise.all([reload(), refresh()]);
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
    }
  };

  return (
    <div className="flex-grow flex flex-col">
      <h2 className="font-serif font-light text-[22px]">Your Athletes</h2>
      <p className="text-sm text-muted mt-1">Enter the share code an athlete gives you.</p>

      <form onSubmit={onAdd} className="flex gap-2 mt-4">
        <input aria-label="Athlete share code" value={value} onChange={(e) => setValue(e.target.value)} placeholder="ABC234"
          className="flex-1 h-12 rounded-xl bg-surface border border-line px-4 font-mono tracking-widest uppercase text-ink placeholder:text-muted" />
        <button disabled={busy || !value.trim()} className="h-12 px-5 rounded-xl bg-accent text-bg font-semibold disabled:opacity-50">
          {busy ? "…" : "Add"}
        </button>
      </form>
      {msg && (
        <div role={msg.ok ? "status" : "alert"} className={`text-sm mt-2 ${msg.ok ? "text-accent" : "text-max"}`}>{msg.text}</div>
      )}

      <h3 className="text-[15px] font-medium text-soft mt-5 mb-2.5">Athletes</h3>
      <PeopleList
        people={people}
        empty="No athletes yet — ask one for their share code."
        highlight={VIEWING?.athleteId}
        to={(p) => `/athlete/${p.personId}`}
        render={(p) => (
          <div className="flex gap-3 items-center shrink-0">
            {VIEWING?.athleteId === p.personId ? (
              <span className="text-xs text-accent">Viewing</span>
            ) : (
              <button className="text-xs text-accent" onClick={() => void view(p.personId)}>Dashboard</button>
            )}
            <button className="text-xs text-max" onClick={() => void remove(p)}>Remove</button>
          </div>
        )}
      />
      <p className="text-xs text-muted mt-2">Tap an athlete for their profile and workouts. "Dashboard" shows their training on Today and History.</p>
      {error && <div role="alert" className="text-sm text-max mt-3">{error}</div>}
    </div>
  );
}

function PeopleList({
  people,
  empty,
  highlight,
  render,
  to,
}: {
  people: LinkedPerson[] | null;
  empty: string;
  highlight?: string;
  render: (p: LinkedPerson) => ReactNode;
  /** Makes the person (picture + name) a link, e.g. to the athlete's profile. */
  to?: (p: LinkedPerson) => string;
}) {
  if (people === null) return <div className="bg-surface rounded-2xl p-3.5 text-sm text-muted">Loading…</div>;
  if (people.length === 0) return <div className="bg-surface rounded-2xl p-3.5 text-sm text-muted">{empty}</div>;
  return (
    <div className="flex flex-col gap-2" data-testid="people-list">
      {people.map((p) => (
        <div key={p.linkId}
          className={`bg-surface rounded-2xl p-3.5 flex justify-between items-center gap-3 ${highlight === p.personId ? "border border-accent/50" : ""}`}>
          <PersonLink to={to?.(p)}>
            {p.avatarUrl ? (
              <img src={p.avatarUrl} alt="" referrerPolicy="no-referrer" className="w-9 h-9 rounded-full object-cover" />
            ) : (
              <div className="w-9 h-9 rounded-full bg-deep flex items-center justify-center text-xs font-semibold">
                {p.name.split(" ").map((w) => w[0]).join("").slice(0, 2)}
              </div>
            )}
            <div className="min-w-0">
              <div className="font-medium truncate">{p.name}</div>
              <div className="text-xs text-muted">Linked {since(p.linkedSince)}{to ? " · Profile ›" : ""}</div>
            </div>
          </PersonLink>
          {render(p)}
        </div>
      ))}
    </div>
  );
}

function PersonLink({ to, children }: { to?: string; children: ReactNode }) {
  const cls = "flex items-center gap-3 min-w-0";
  return to ? (
    <Link to={to} className={cls} data-testid="person-link">{children}</Link>
  ) : (
    <div className={cls}>{children}</div>
  );
}

/** Demo mode (no Supabase): the original static design. */
function DemoCoach() {
  const { COACH_LINK } = useAppData();
  if (!COACH_LINK) return null;
  return (
    <div className="flex-grow flex flex-col">
      <h2 className="font-serif font-light text-[22px]">Coach Access</h2>
      <div className="text-[11px] tracking-wider text-muted uppercase mt-4 mb-3">Share Code</div>
      <div className="bg-deep rounded-2xl p-5 text-center">
        <div className="font-mono text-[34px] tracking-[4px] font-semibold text-accent my-3">{COACH_LINK.shareCode}</div>
        <div className="text-xs text-muted">Share this code with your coach</div>
      </div>
      <h3 className="text-[15px] font-medium text-soft mt-5 mb-2.5">Coaches with Access</h3>
      <div className="bg-surface rounded-2xl p-3.5">
        <div className="font-medium">{COACH_LINK.coachName}</div>
        <div className="text-xs text-muted">Linked {COACH_LINK.linkedSince}</div>
      </div>
    </div>
  );
}
