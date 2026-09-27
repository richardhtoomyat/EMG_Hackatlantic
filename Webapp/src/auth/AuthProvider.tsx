import { useEffect, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { initialAuthError, supabase } from "../lib/supabase";
import { AuthContext, type SignUpInput } from "./authContext";
import { releaseStation } from "../lib/stationApi";

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

  // Where Supabase sends the user back after Google / email confirmation.
  // Must be listed in Supabase → Authentication → URL Configuration → Redirect URLs.
  const redirectTo = () => window.location.origin + window.location.pathname;

  const signInWithGoogle = async () => {
    if (!supabase) return "Supabase is not configured";
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: redirectTo(), queryParams: { prompt: "select_account" } },
    });
    return error ? error.message : null;
  };

  const signUp = async ({ firstName, lastName, email, password, role }: SignUpInput) => {
    if (!supabase) return { error: "Supabase is not configured", needsConfirmation: false };
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      // Copied into public.profiles by the on-signup trigger (supabase/signup_profiles.sql).
      options: {
        data: { first_name: firstName, last_name: lastName, name: `${firstName} ${lastName}`.trim(), role },
        emailRedirectTo: redirectTo(),
      },
    });
    if (error) return { error: error.message, needsConfirmation: false };
    // Supabase returns an obfuscated user with no identities when the email is already registered.
    if (data.user && data.user.identities?.length === 0) {
      return { error: "An account with this email already exists. Try signing in.", needsConfirmation: false };
    }
    return { error: null, needsConfirmation: !data.session };
  };

  const signOut = async () => {
    if (!supabase) return;
    // Free the sensor station first (needs the token); an unfinished workout is discarded.
    await releaseStation().catch(() => {});
    const { error } = await supabase.auth.signOut();
    // Clear local state even if the server call failed (e.g. offline).
    if (error) console.error("[activateMyo] sign-out error:", error);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, enabled: !!supabase, signIn, signInWithGoogle, signUp, signOut, redirectError: initialAuthError }}>
      {children}
    </AuthContext.Provider>
  );
}
