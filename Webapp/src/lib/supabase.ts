import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase client, configured from Vite env vars (set them in `.env.local`
 * locally and in Vercel → Project → Settings → Environment Variables):
 *
 *   VITE_SUPABASE_URL       = https://<project-ref>.supabase.co
 *   VITE_SUPABASE_ANON_KEY  = <anon / publishable key>
 *
 * If the URL/key are missing, `supabase` is null and the app keeps running
 * on the mock data in data/mockData.ts.
 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * An OAuth/email-link redirect that failed (e.g. the user cancelled Google
 * sign-in) comes back as `#error=…&error_description=…`. Read it before
 * supabase-js consumes the URL so the login page can show it.
 */
function readRedirectError(): string | null {
  if (typeof window === "undefined") return null;
  for (const raw of [window.location.hash.replace(/^#\/?/, ""), window.location.search.slice(1)]) {
    const params = new URLSearchParams(raw);
    const msg = params.get("error_description") || params.get("error");
    if (msg) return msg.replace(/\+/g, " ");
  }
  return null;
}
export const initialAuthError = readRedirectError();

export const supabase: SupabaseClient | null =
  url && anonKey ? createClient(url, anonKey) : null;
