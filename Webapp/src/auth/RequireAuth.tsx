import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "./authContext";

/** Redirects to /login when Supabase auth is on and nobody is signed in. */
export default function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading, enabled } = useAuth();
  if (!enabled) return <>{children}</>; // mock-data demo mode
  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-muted text-sm">Loading…</div>;
  }
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
