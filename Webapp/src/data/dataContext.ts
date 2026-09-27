import { createContext, useContext } from "react";
import * as mock from "./mockData";
import type { AppData } from "./types";

export const MOCK_DATA: AppData = {
  ATHLETE: mock.ATHLETE,
  COACH_LINK: mock.COACH_LINK,
  READINESS: mock.READINESS,
  WEEK_SUMMARY: mock.WEEK_SUMMARY,
  WEEKLY_READINESS_TREND_PCT: mock.WEEKLY_READINESS_TREND_PCT,
  TODAY_METRICS: mock.TODAY_METRICS,
  CURRENT_SESSION: mock.CURRENT_SESSION,
  LIVE_SET: mock.LIVE_SET,
  SESSION_HISTORY: mock.SESSION_HISTORY,
  WEEKLY_TRENDS: mock.WEEKLY_TRENDS,
  VIEWING: null,
};

export type DataSource = "mock" | "loading" | "supabase" | "error";

export const DataContext = createContext<{ data: AppData; source: DataSource; refresh: () => Promise<void> }>({
  data: MOCK_DATA,
  source: "mock",
  refresh: async () => {},
});

/** All page data — mock until Supabase loads, then live. */
export function useAppData(): AppData {
  return useContext(DataContext).data;
}

/** Re-fetch the signed-in user's data (e.g. after saving a session). Resolves once loaded. */
export function useRefreshData(): () => Promise<void> {
  return useContext(DataContext).refresh;
}

/** Where the current data came from (handy for a debug badge). */
export function useDataSource(): DataSource {
  return useContext(DataContext).source;
}
