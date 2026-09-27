/**
 * Share with Coach (supabase/coach_sharing.sql): athletes create a one-time
 * code, coaches redeem it; either side can remove the link. A coach can have
 * several athletes and picks whose data the app shows.
 */
import { supabase } from "../lib/supabase";

export interface ShareCode {
  code: string;
  expiresAt: string;
}

export interface LinkedPerson {
  linkId: string;
  personId: string; // the coach (for an athlete) or the athlete (for a coach)
  name: string;
  avatarUrl?: string;
  linkedSince: string | null;
}

const VIEW_KEY = "activatemyo.viewAthlete";

/** The athlete a coach chose to view (per browser). */
export function getViewedAthlete(): string | null {
  try {
    return localStorage.getItem(VIEW_KEY);
  } catch {
    return null;
  }
}

export function setViewedAthlete(athleteId: string | null): void {
  try {
    if (athleteId) localStorage.setItem(VIEW_KEY, athleteId);
    else localStorage.removeItem(VIEW_KEY);
  } catch {
    /* per-browser convenience only */
  }
}

const message = (e: unknown) => (e as { message?: string })?.message ?? String(e);

function client() {
  if (!supabase) throw new Error("Supabase is not configured");
  return supabase;
}

/** Athlete: the current unexpired code, if any. */
export async function getActiveShareCode(): Promise<ShareCode | null> {
  const { data, error } = await client()
    .from("share_codes")
    .select("code,expires_at")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(message(error));
  return data ? { code: data.code, expiresAt: data.expires_at } : null;
}

/** Athlete: make a new code (replaces any older one). */
export async function createShareCode(): Promise<ShareCode> {
  const { data, error } = await client().rpc("create_share_code");
  if (error) throw new Error(message(error));
  const row = (Array.isArray(data) ? data[0] : data) as { code: string; expires_at: string };
  return { code: row.code, expiresAt: row.expires_at };
}

/** Coach: redeem an athlete's code. */
export async function claimShareCode(code: string): Promise<{ athleteId: string; athleteName: string }> {
  const { data, error } = await client().rpc("claim_share_code", { p_code: code });
  if (error) throw new Error(message(error));
  const row = (Array.isArray(data) ? data[0] : data) as { athlete_id: string; athlete_name: string };
  return { athleteId: row.athlete_id, athleteName: row.athlete_name };
}

/** People linked to `userId`: their coaches (athlete) or their athletes (coach). */
export async function listLinked(userId: string, asCoach: boolean): Promise<LinkedPerson[]> {
  const sb = client();
  const { data: links, error } = await sb
    .from("coach_links")
    .select("id,athlete_id,coach_id,linked_since")
    .eq(asCoach ? "coach_id" : "athlete_id", userId)
    .order("linked_since", { ascending: false });
  if (error) throw new Error(message(error));
  if (!links?.length) return [];

  const ids = links.map((l) => (asCoach ? l.athlete_id : l.coach_id));
  const { data: people, error: e2 } = await sb.from("profiles").select("*").in("id", ids);
  if (e2) throw new Error(message(e2));
  const byId = new Map((people ?? []).map((p) => [p.id as string, p as Record<string, string | null>]));
  return links.map((l) => {
    const id = asCoach ? l.athlete_id : l.coach_id;
    const p = byId.get(id);
    const full = [p?.first_name, p?.last_name].filter(Boolean).join(" ");
    return {
      linkId: l.id,
      personId: id,
      name: full || p?.name || (asCoach ? "Athlete" : "Coach"),
      avatarUrl: p?.avatar_url ?? undefined,
      linkedSince: l.linked_since,
    };
  });
}

export async function removeLink(linkId: string): Promise<void> {
  const { data, error } = await client().from("coach_links").delete().eq("id", linkId).select("id");
  if (error) throw new Error(message(error));
  if (!data?.length) throw new Error("Couldn't remove access (run supabase/coach_sharing.sql).");
}
