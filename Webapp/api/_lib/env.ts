import { HttpError } from "./http.js";

/**
 * Server-side settings (Vercel → Project → Settings → Environment Variables).
 * SUPABASE_SERVICE_ROLE_KEY must NEVER be exposed to the browser — it is only
 * read here, inside Vercel functions.
 */
export function env() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!supabaseUrl || !serviceRoleKey) {
    throw new HttpError(503, "Server not configured: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel");
  }
  return {
    supabaseUrl,
    serviceRoleKey,
    // Upstash Redis added through Vercel's Marketplace sets KV_REST_API_*; plain Upstash uses UPSTASH_REDIS_REST_*.
    redisUrl: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "",
    redisToken: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "",
    // Only for local tests: keep live data in this process's memory instead of Redis.
    memoryLiveStore: process.env.LIVE_STORE === "memory",
  };
}
