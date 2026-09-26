import { ageFromBirthDate } from "../lib/bodyMetrics";
import { supabase } from "../lib/supabase";

export interface BodyMetricsUpdate {
  heightCm?: number;
  weightKg?: number;
  birthDate?: string; // YYYY-MM-DD
}

/**
 * Updates the signed-in user's profile. Saving a value (even an unchanged one)
 * stamps its *_updated_at, which resets that reminder. Requires
 * supabase/body_metrics.sql.
 */
export async function saveBodyMetrics(userId: string, u: BodyMetricsUpdate): Promise<void> {
  if (!supabase) throw new Error("Supabase is not configured");
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {};
  if (u.heightCm !== undefined) Object.assign(patch, { height_cm: u.heightCm, height_updated_at: now });
  if (u.weightKg !== undefined) Object.assign(patch, { weight_kg: u.weightKg, weight_updated_at: now });
  if (u.birthDate !== undefined) {
    // `age` is kept in sync for anything else reading the column; the app derives age from birth_date.
    Object.assign(patch, { birth_date: u.birthDate, age: ageFromBirthDate(u.birthDate) });
  }

  const { data, error } = await supabase.from("profiles").update(patch).eq("id", userId).select("id");
  if (error) throw error;
  // RLS reports a blocked update as "0 rows", not as an error.
  if (!data?.length) {
    throw new Error("Your profile could not be updated (run supabase/body_metrics.sql to allow it).");
  }
}
