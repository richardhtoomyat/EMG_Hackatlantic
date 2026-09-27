import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAppData, useDataSource } from "../data/dataContext";

/** Sends a signed-in user who hasn't chosen athlete / coach yet (e.g. a new Google sign-up) to /choose-role. */
export default function RequireRole({ children }: { children: ReactNode }) {
  const { ATHLETE } = useAppData();
  const source = useDataSource();
  // Decide only on real, loaded data — never on the empty placeholder or after a load error.
  if (source === "supabase" && ATHLETE.roleSelected === false) return <Navigate to="/choose-role" replace />;
  return <>{children}</>;
}
