import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActivityEventType } from "@/lib/constants/prospects";
import type { Database, Json } from "@/lib/db/types";

export type ActivityInput = {
  prospectId?: string | null;
  eventType: ActivityEventType;
  description: string;
  metadata?: Json;
};

type Client = SupabaseClient<Database>;

export async function logActivity(supabase: Client, input: ActivityInput) {
  return logActivities(supabase, [input]);
}

export async function logActivities(supabase: Client, inputs: ActivityInput[]) {
  if (inputs.length === 0) return { ok: true as const };

  const { error } = await supabase.from("activity_log").insert(
    inputs.map((input) => ({
      prospect_id: input.prospectId ?? null,
      event_type: input.eventType,
      description: input.description,
      metadata: input.metadata ?? {},
    })),
  );

  if (error) {
    console.error("Activity log insert failed:", error.message);
    return { ok: false as const, error: error.message };
  }

  return { ok: true as const };
}
