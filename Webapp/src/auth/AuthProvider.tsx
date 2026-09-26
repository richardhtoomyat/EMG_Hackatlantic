import { useEffect, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { AuthContext } from "./authContext";

/**
 * Supabase email/password auth. The session is persisted in localStorage by
 * supabase-js, so a refresh keeps the user signed in.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(!!supabase);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    if (!supabase) return "Supabase is not configured";
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? error.message : null;
  };

  const signOut = async () => {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    // Clear local state even if the server call failed (e.g. offline).
    if (error) console.error("[activateMyo] sign-out error:", error);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, enabled: !!supabase, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
