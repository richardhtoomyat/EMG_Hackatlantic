import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAppData, useDataSource } from "../data/dataContext";
import { needsBodyMetricsSetup } from "../lib/bodyMetrics";

/** Sends a signed-in athlete without height/weight/date of birth to the setup page first. */
export default function RequireBodyMetrics({ children }: { children: ReactNode }) {
  const { ATHLETE } = useAppData();
  const source = useDataSource();
  // Decide only on real, loaded data — never on the empty placeholder or after a load error.
  if (source === "supabase" && needsBodyMetricsSetup(ATHLETE)) return <Navigate to="/body-metrics" replace />;
  return <>{children}</>;
}
