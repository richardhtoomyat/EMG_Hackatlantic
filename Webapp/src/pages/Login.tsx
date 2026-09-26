import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { useAuth, type SignUpInput } from "../auth/authContext";

type Mode = "signin" | "signup";

export default function Login() {
  const { user, enabled, signIn, signInWithGoogle, signUp, redirectError } = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<SignUpInput["role"]>("athlete");
  const [error, setError] = useState<string | null>(redirectError);
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
      const res = await signUp({ firstName: firstName.trim(), lastName: lastName.trim(), email: email.trim(), password, role });
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

  const onGoogle = async () => {
    setBusy(true);
    setError(null);
    const err = await signInWithGoogle(); // on success the browser leaves for Google
    if (err) {
      setError(err);
      setBusy(false);
    }
  };

  const input =
    "h-12 w-full rounded-xl bg-surface border border-line px-4 text-ink placeholder:text-muted focus:outline-none focus:border-accent";
  const tab = (m: Mode) =>
    `flex-1 h-10 rounded-full text-sm font-medium ${mode === m ? "bg-surface text-ink" : "text-muted"}`;

  return (
    <div className="max-w-[420px] mx-auto min-h-screen flex flex-col justify-center p-6">
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

      <button type="button" onClick={onGoogle} disabled={busy}
        className="h-12 rounded-full bg-white text-[#1f1f1f] font-semibold flex items-center justify-center gap-3 disabled:opacity-60">
        <GoogleIcon />
        Continue with Google
      </button>

      <div className="flex items-center gap-3 my-5 text-xs text-muted">
        <span className="flex-1 h-px bg-line" />
        or with email
        <span className="flex-1 h-px bg-line" />
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        {mode === "signup" && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-3">
                <label className="text-xs text-muted" htmlFor="firstName">First name</label>
                <input id="firstName" autoComplete="given-name" required className={input}
                  value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              </div>
              <div className="flex flex-col gap-3">
                <label className="text-xs text-muted" htmlFor="lastName">Last name</label>
                <input id="lastName" autoComplete="family-name" required className={input}
                  value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </div>
            </div>

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

/** Google "G" mark (official colours). */
function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}
