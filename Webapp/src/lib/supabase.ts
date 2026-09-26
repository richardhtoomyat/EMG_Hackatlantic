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

export const supabase: SupabaseClient | null =
  url && anonKey ? createClient(url, anonKey) : null;
