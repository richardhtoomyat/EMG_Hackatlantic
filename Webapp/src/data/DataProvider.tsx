import { useEffect, useState, type ReactNode } from "react";
import { DataContext, MOCK_DATA, type DataSource } from "./dataContext";
import { fetchAppData } from "./supabaseData";
import type { AppData } from "./types";

/**
 * Renders immediately with mock data, then swaps in Supabase data once it
 * loads (if VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are set). On any
 * error it stays on mock data and logs the problem to the console.
 */
export function DataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(MOCK_DATA);
  const [source, setSource] = useState<DataSource>("loading");

  useEffect(() => {
    let cancelled = false;

    fetchAppData(MOCK_DATA)
      .then((result) => {
        if (cancelled) return;
        if (!result) {
          setSource("mock");
          return;
        }
        setData(result);
        setSource("supabase");
      })
      .catch((err) => {
        console.error("[activateMyo] Supabase load failed, using mock data:", err);
        if (!cancelled) setSource("error");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return <DataContext.Provider value={{ data, source }}>{children}</DataContext.Provider>;
}
