import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { logActivity } from "@/lib/activity/log";
import type { Database } from "@/lib/db/types";

type Client = SupabaseClient<Database>;

export async function createFollowUp(
  supabase: Client,
  input: { prospectId: string; dueAt: string; notes: string; actor: string },
) {
  const due = new Date(input.dueAt);
  if (Number.isNaN(due.getTime())) {
    return { ok: false as const, error: "Choose a valid due date." };
  }

  const { data: prospect, error: prospectError } = await supabase
    .from("prospects")
    .select("id, instagram_username")
    .eq("id", input.prospectId)
    .maybeSingle();

  if (prospectError) return { ok: false as const, error: prospectError.message };
  if (!prospect) return { ok: false as const, error: "That prospect could not be found." };

  const { data, error } = await supabase
    .from("follow_ups")
    .insert({
      prospect_id: prospect.id,
      due_at: due.toISOString(),
      status: "pending",
      notes: input.notes.trim() || null,
    })
    .select("id")
    .single();

  if (error) return { ok: false as const, error: error.message };

  await logActivity(supabase, {
    prospectId: prospect.id,
    eventType: "follow_up_created",
    description: `Follow-up scheduled for @${prospect.instagram_username}.`,
    metadata: { actor: input.actor, followUpId: data.id },
  });

  return { ok: true as const, id: data.id };
}

export async function updateFollowUp(
  supabase: Client,
  input: { id: string; dueAt: string; notes: string },
) {
  const due = new Date(input.dueAt);
  if (Number.isNaN(due.getTime())) {
    return { ok: false as const, error: "Choose a valid due date." };
  }

  const { error } = await supabase
    .from("follow_ups")
    .update({
      due_at: due.toISOString(),
      notes: input.notes.trim() || null,
    })
    .eq("id", input.id)
    .eq("status", "pending");

  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const };
}

export async function completeFollowUp(supabase: Client, id: string, actor: string) {
  const { data, error } = await supabase
    .from("follow_ups")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "pending")
    .select("id, prospect_id, prospects(instagram_username)")
    .maybeSingle();

  if (error) return { ok: false as const, error: error.message };
  if (!data) return { ok: false as const, error: "That follow-up is no longer pending." };

  const username = data.prospects?.instagram_username;
  await logActivity(supabase, {
    prospectId: data.prospect_id,
    eventType: "follow_up_completed",
    description: username
      ? `Follow-up completed for @${username}.`
      : "Follow-up completed.",
    metadata: { actor, followUpId: data.id },
  });

  return { ok: true as const };
}

export async function cancelFollowUp(supabase: Client, id: string) {
  const { data, error } = await supabase
    .from("follow_ups")
    .update({ status: "cancelled" })
    .eq("id", id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (error) return { ok: false as const, error: error.message };
  if (!data) return { ok: false as const, error: "That follow-up is no longer pending." };
  return { ok: true as const };
}
