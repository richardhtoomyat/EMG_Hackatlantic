import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { useAuth, type SignUpInput } from "../auth/authContext";

type Mode = "signin" | "signup";

export default function Login() {
  const { user, enabled, signIn, signUp } = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<SignUpInput["role"]>("athlete");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!enabled || user) return <Navigate to="/" replace />;

  const switchMode = (m: Mode) => {
    setMode(m);
    setError(null);
    setNotice(null);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    if (mode === "signin") {
      setError(await signIn(email.trim(), password));
    } else {
      const res = await signUp({ name: name.trim(), email: email.trim(), password, role });
      if (res.error) setError(res.error);
      else if (res.needsConfirmation) {
        setNotice(`Check ${email.trim()} for a confirmation link, then sign in.`);
        setMode("signin");
        setPassword("");
      }
      // Otherwise the new session signs the user straight in and <Navigate> takes over.
    }
    setBusy(false);
  };

  const input =
    "h-12 w-full rounded-xl bg-surface border border-line px-4 text-ink placeholder:text-muted focus:outline-none focus:border-accent";
  const tab = (m: Mode) =>
    `flex-1 h-10 rounded-full text-sm font-medium ${mode === m ? "bg-surface text-ink" : "text-muted"}`;

  return (
    <div className="max-w-[420px] mx-auto bg-bg min-h-screen flex flex-col justify-center p-6">
      <div className="font-serif font-light text-[34px] text-center">
        activate<span className="text-accent font-medium">Myo</span>
      </div>
      <p className="text-sm text-muted text-center mt-1 mb-6">
        {mode === "signin" ? "Sign in to see your training" : "Create your account"}
      </p>

      <div className="flex gap-1 p-1 rounded-full bg-deep border border-line mb-6" role="tablist">
        <button type="button" role="tab" aria-selected={mode === "signin"} className={tab("signin")} onClick={() => switchMode("signin")}>
          Sign in
        </button>
        <button type="button" role="tab" aria-selected={mode === "signup"} className={tab("signup")} onClick={() => switchMode("signup")}>
          Sign up
        </button>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        {mode === "signup" && (
          <>
            <label className="text-xs text-muted" htmlFor="name">Name</label>
            <input id="name" autoComplete="name" required className={input}
              value={name} onChange={(e) => setName(e.target.value)} />

            <span className="text-xs text-muted mt-1">I am a…</span>
            <div className="grid grid-cols-2 gap-2">
              {(["athlete", "coach"] as const).map((r) => (
                <button key={r} type="button" onClick={() => setRole(r)} aria-pressed={role === r}
                  className={`h-11 rounded-xl border text-sm capitalize ${role === r ? "border-accent text-ink bg-surface" : "border-line text-muted"}`}>
                  {r}
                </button>
              ))}
            </div>
          </>
        )}

        <label className="text-xs text-muted mt-1" htmlFor="email">Email</label>
        <input id="email" type="email" autoComplete="email" required className={input}
          value={email} onChange={(e) => setEmail(e.target.value)} />

        <label className="text-xs text-muted mt-1" htmlFor="password">Password</label>
        <input id="password" type="password" required minLength={mode === "signup" ? 6 : undefined}
          autoComplete={mode === "signup" ? "new-password" : "current-password"} className={input}
          value={password} onChange={(e) => setPassword(e.target.value)} />
        {mode === "signup" && <span className="text-[11px] text-muted">At least 6 characters</span>}

        {error && <div role="alert" className="text-sm text-max mt-1">{error}</div>}
        {notice && <div role="status" className="text-sm text-accent mt-1">{notice}</div>}

        <button type="submit" disabled={busy}
          className="h-12 rounded-full bg-accent text-bg font-semibold mt-4 disabled:opacity-60">
          {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
        </button>
      </form>
    </div>
  );
}
