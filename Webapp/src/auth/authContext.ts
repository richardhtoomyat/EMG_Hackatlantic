import { createContext, useContext } from "react";
import type { User } from "@supabase/supabase-js";

export interface AuthState {
  /** Signed-in Supabase user, or null. */
  user: User | null;
  /** True until the stored session has been checked on startup. */
  loading: boolean;
  /** False when Supabase env vars are missing (mock-data demo mode, no login). */
  enabled: boolean;
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthState>({
  user: null,
  loading: false,
  enabled: false,
  signIn: async () => "Auth is not configured",
  signOut: async () => {},
});

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
