import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { useAuth } from "../auth/authContext";
import { DataContext, MOCK_DATA, type DataSource } from "./dataContext";
import { emptyAppData, fetchAppData } from "./supabaseData";
import type { AppData } from "./types";

type Loaded = { userId: string; data: AppData; source: DataSource };

/**
 * Supabase not configured → mock data (demo mode).
 * Signed in → the user's own rows from Supabase. Until they arrive the user
 * sees an empty skeleton with their email, never another user's/mock data.
 */
export function DataProvider({ children }: { children: ReactNode }) {
  const { user, enabled } = useAuth();
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (!enabled || !user) return;
    let cancelled = false;
    load(user, () => cancelled).then((next) => next && setLoaded(next));
    return () => {
      cancelled = true;
    };
  }, [enabled, user]);

  const refresh = useCallback(async () => {
    if (!enabled || !user) return;
    const next = await load(user, () => false);
    if (next) setLoaded(next);
  }, [enabled, user]);

  let value: { data: AppData; source: DataSource };
  if (!enabled) value = { data: MOCK_DATA, source: "mock" };
  else if (!user) value = { data: MOCK_DATA, source: "loading" };
  else if (loaded?.userId === user.id) value = loaded;
  else value = { data: emptyAppData(MOCK_DATA, user), source: "loading" };

  return <DataContext.Provider value={{ ...value, refresh }}>{children}</DataContext.Provider>;
}

async function load(user: User, isCancelled: () => boolean): Promise<Loaded | null> {
  try {
    const data = await fetchAppData(MOCK_DATA, user);
    return isCancelled() ? null : { userId: user.id, data, source: "supabase" };
  } catch (err) {
    console.error("[activateMyo] Supabase load failed:", err);
    return isCancelled() ? null : { userId: user.id, data: emptyAppData(MOCK_DATA, user), source: "error" };
  }
}
