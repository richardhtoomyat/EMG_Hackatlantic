import { createContext, useContext } from "react";
import type { User } from "@supabase/supabase-js";

export interface SignUpInput {
  name: string;
  email: string;
  password: string;
  role: "athlete" | "coach";
}

export interface AuthState {
  /** Signed-in Supabase user, or null. */
  user: User | null;
  /** True until the stored session has been checked on startup. */
  loading: boolean;
  /** False when Supabase env vars are missing (mock-data demo mode, no login). */
  enabled: boolean;
  signIn: (email: string, password: string) => Promise<string | null>;
  /** Creates the account; `needsConfirmation` when Supabase requires email confirmation first. */
  signUp: (input: SignUpInput) => Promise<{ error: string | null; needsConfirmation: boolean }>;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthState>({
  user: null,
  loading: false,
  enabled: false,
  signIn: async () => "Auth is not configured",
  signUp: async () => ({ error: "Auth is not configured", needsConfirmation: false }),
  signOut: async () => {},
});

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
