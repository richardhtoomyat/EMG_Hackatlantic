import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env.js";

let admin: SupabaseClient | null = null;

/** Supabase client with the service_role key (bypasses RLS) — server only. */
export function db(): SupabaseClient {
  if (!admin) {
    const e = env();
    admin = createClient(e.supabaseUrl, e.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return admin;
}

/** Throws a readable error for a failed Supabase call. */
export function check<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}
