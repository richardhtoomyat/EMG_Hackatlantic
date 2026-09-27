/** Athlete / coach role (supabase/roles.sql set_my_role): chosen once, changeable while unlinked. */
import { supabase } from "../lib/supabase";

export type Role = "athlete" | "coach";

export async function setMyRole(role: Role): Promise<void> {
  if (!supabase) throw new Error("Supabase is not configured");
  const { error } = await supabase.rpc("set_my_role", { p_role: role });
  if (error) {
    if (/set_my_role/.test(error.message) && /function|schema cache/i.test(error.message)) {
      throw new Error("Run supabase/roles.sql in Supabase first.");
    }
    throw new Error(error.message);
  }
}

export const isCoach = (role?: string | null) => role?.toLowerCase() === "coach";
