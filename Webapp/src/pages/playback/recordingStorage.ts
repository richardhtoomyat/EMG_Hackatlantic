import { supabase } from "../../lib/supabase";

export async function uploadRecording(userId: string, recordingType: 0 | 1, rawData: unknown): Promise<void> {
  if (!supabase) throw new Error("Supabase is not configured");
  const { error } = await supabase.from("emg_recordings").insert({
    user_id: userId,
    recording_type: recordingType,
    raw_data: rawData,
  });
  if (error) throw error;
}
