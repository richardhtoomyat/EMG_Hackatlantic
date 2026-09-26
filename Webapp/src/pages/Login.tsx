import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/authContext";

export default function Login() {
  const { user, enabled, signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!enabled || user) return <Navigate to="/" replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(await signIn(email.trim(), password));
    setBusy(false);
  };

  const input =
    "h-12 w-full rounded-xl bg-surface border border-line px-4 text-ink placeholder:text-muted focus:outline-none focus:border-accent";

  return (
    <div className="max-w-[420px] mx-auto bg-bg min-h-screen flex flex-col justify-center p-6">
      <div className="font-serif font-light text-[34px] text-center">
        activate<span className="text-accent font-medium">Myo</span>
      </div>
      <p className="text-sm text-muted text-center mt-1 mb-8">Sign in to see your training</p>

      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <label className="text-xs text-muted" htmlFor="email">Email</label>
        <input id="email" type="email" autoComplete="email" required className={input}
          value={email} onChange={(e) => setEmail(e.target.value)} />
        <label className="text-xs text-muted mt-1" htmlFor="password">Password</label>
        <input id="password" type="password" autoComplete="current-password" required className={input}
          value={password} onChange={(e) => setPassword(e.target.value)} />

        {error && <div role="alert" className="text-sm text-max mt-1">{error}</div>}

        <button type="submit" disabled={busy}
          className="h-12 rounded-full bg-accent text-bg font-semibold mt-4 disabled:opacity-60">
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
