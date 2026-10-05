"use server";

import { revalidatePath } from "next/cache";
import { listProspectIds } from "@/lib/db/prospects";
import type { ProspectQuery } from "@/lib/db/prospects";
import { fallbackSettings, fallbackTargeting, getSettings, getTargetingSettings } from "@/lib/db/settings";
import { outreachBlockReason } from "@/lib/outreach/eligibility";
import { requeueSummary } from "@/lib/outreach/requeue";
import { approvalSummary, loadSendOccupancy, queueProspect, requeueProspect } from "@/lib/outreach/service";
import {
  changeProspectStatus,
  createManualProspect,
  saveMessageOverride,
  type ManualProspectInput,
} from "@/lib/prospects/service";
import { canApprove } from "@/lib/prospects/status";
import { requireUser } from "@/lib/supabase/auth";
import { isUuid } from "@/lib/utils/format";

export type ActionResult =
  | { ok: true; message?: string; id?: string }
  | { ok: false; error: string };

function revalidateProspectPaths(ids: string[]) {
  revalidatePath("/");
  revalidatePath("/prospects");
  revalidatePath("/review");
  revalidatePath("/analytics");
  revalidatePath("/follow-ups");
  revalidatePath("/outreach");
  revalidatePath("/worker");
  ids.forEach((id) => revalidatePath(`/prospects/${id}`));
}

export async function approveProspects(ids: string[]): Promise<ActionResult> {
  return approveForOutreach(ids);
}

export async function approveMatchingProspects(query: ProspectQuery): Promise<ActionResult> {
  const ids = await listProspectIds(query);
  return approveForOutreach(ids);
}

export async function deleteMatchingProspects(query: ProspectQuery): Promise<ActionResult> {
  const ids = await listProspectIds(query);
  return deleteProspects(ids);
}

export async function skipProspects(ids: string[]): Promise<ActionResult> {
  return updateStatus(ids, "skipped");
}

export async function approveVisibleQueue(ids: string[]): Promise<ActionResult> {
  return approveForOutreach(ids);
}

export async function requeueProspects(ids: string[]): Promise<ActionResult> {
  if (ids.length === 0) return { ok: false, error: "Select at least one prospect." };
  if (ids.some((id) => !isUuid(id))) {
    return { ok: false, error: "One of the selected prospects is invalid." };
  }

  const { supabase, user } = await requireUser();
  const actor = user.email ?? "authenticated user";
  const settingsResult = await getSettings();
  const settings = settingsResult.ok ? settingsResult.data : fallbackSettings();
  const occupancy = await loadSendOccupancy(supabase);
  if (!occupancy.ok) return { ok: false, error: occupancy.error };

  const { data, error } = await supabase.from("prospects").select("*").in("id", [...new Set(ids)]);
  if (error) return { ok: false, error: "Those prospects could not be loaded." };

  let requeued = 0;
  let skipped = 0;
  const updated: string[] = [];
  for (const prospect of data ?? []) {
    const result = await requeueProspect({
      supabase,
      prospect,
      settings,
      occupied: occupancy.occupied,
      actor,
    });
    if (!result.ok) {
      revalidateProspectPaths(updated);
      return { ok: false, error: result.error };
    }
    updated.push(prospect.id);
    if (result.created) requeued += 1;
    else skipped += 1;
  }
  const missing = [...new Set(ids)].length - (data?.length ?? 0);
  skipped += missing;

  revalidateProspectPaths(updated);
  return { ok: true, message: requeueSummary({ requeued, skipped }) };
}

async function approveForOutreach(ids: string[]): Promise<ActionResult> {
  if (ids.length === 0) return { ok: false, error: "Select at least one prospect." };
  if (ids.some((id) => !isUuid(id))) {
    return { ok: false, error: "One of the selected prospects is invalid." };
  }

  const { supabase, user } = await requireUser();
  const actor = user.email ?? "authenticated user";
  const [settingsResult, targetingResult] = await Promise.all([getSettings(), getTargetingSettings()]);
  const settings = settingsResult.ok ? settingsResult.data : fallbackSettings();
  const targeting = targetingResult.ok ? targetingResult.data : fallbackTargeting();

  const occupancy = await loadSendOccupancy(supabase);
  if (!occupancy.ok) return { ok: false, error: occupancy.error };

  const { data, error } = await supabase.from("prospects").select("*").in("id", [...new Set(ids)]);
  if (error) return { ok: false, error: "Those prospects could not be loaded." };

  const skipped: string[] = [];
  const ready = [];
  for (const prospect of data ?? []) {
    if (!canApprove(prospect.status)) {
      skipped.push("not waiting for review");
      continue;
    }
    const reason = outreachBlockReason(prospect, targeting);
    if (reason) {
      skipped.push(reason);
      continue;
    }
    ready.push(prospect);
  }

  if (ready.length === 0) {
    return { ok: false, error: approvalSummary({ approved: 0, queued: 0, skipped }) };
  }

  const updated = await changeProspectStatus(supabase, {
    ids: ready.map((prospect) => prospect.id),
    status: "approved",
    actor,
  });
  if (!updated.ok) return { ok: false, error: updated.error };

  let queued = 0;
  for (const prospect of ready) {
    const result = await queueProspect({
      supabase,
      prospect,
      settings,
      targeting,
      occupied: occupancy.occupied,
      actor,
    });
    if (!result.ok) {
      revalidateProspectPaths(ready.map((item) => item.id));
      return { ok: false, error: result.error };
    }
    if (result.created) queued += 1;
    else if (result.skipped) skipped.push(result.skipped);
  }

  revalidateProspectPaths(ready.map((prospect) => prospect.id));
  return {
    ok: true,
    message: approvalSummary({ approved: ready.length, queued, skipped }),
  };
}

async function updateStatus(ids: string[], status: "approved" | "skipped"): Promise<ActionResult> {
  if (ids.length === 0) return { ok: false, error: "Select at least one prospect." };
  if (ids.some((id) => !isUuid(id))) {
    return { ok: false, error: "One of the selected prospects is invalid." };
  }

  const { supabase, user } = await requireUser();
  const result = await changeProspectStatus(supabase, {
    ids,
    status,
    actor: user.email ?? "authenticated user",
  });

  if (!result.ok) {
    if (result.updated.length > 0) {
      revalidateProspectPaths(result.updated.map((prospect) => prospect.id));
    }
    return { ok: false, error: result.error };
  }
  if (status === "approved") {
    const links = await supabase.from("prospects").select("source_seed_id").in("id", result.updated.map((prospect) => prospect.id));
    if (!links.error) {
      for (const row of links.data ?? []) {
        if (row.source_seed_id) await supabase.rpc("bump_discovery_seed", { p_id: row.source_seed_id, p_approved: 1 });
      }
    }
  }
  revalidateProspectPaths(result.updated.map((prospect) => prospect.id));
  return { ok: true, message: result.message };
}

export async function saveProspectNotes(id: string, notes: string): Promise<ActionResult> {
  if (!isUuid(id)) return { ok: false, error: "That prospect could not be found." };
  const { supabase } = await requireUser();
  const { error } = await supabase.from("prospects").update({ notes: notes.trim() }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateProspectPaths([id]);
  return { ok: true };
}

export async function addProspect(input: ManualProspectInput): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  const result = await createManualProspect(supabase, input, user.email ?? "authenticated user");
  if (!result.ok) return { ok: false, error: result.error };
  revalidateProspectPaths([result.id]);
  return { ok: true, id: result.id };
}

export async function updateMessageOverride(id: string, message: string): Promise<ActionResult> {
  if (!isUuid(id)) return { ok: false, error: "That prospect could not be found." };
  const trimmed = message.trim();
  if (!trimmed) return { ok: false, error: "The message cannot be empty." };
  const { supabase } = await requireUser();
  const result = await saveMessageOverride(supabase, id, trimmed);
  if (!result.ok) return result;
  revalidateProspectPaths([id]);
  return { ok: true };
}

export async function deleteProspects(ids: string[]): Promise<ActionResult> {
  const unique = [...new Set(ids.filter((id) => isUuid(id)))];
  if (unique.length === 0) return { ok: false, error: "Choose at least one prospect." };
  const { supabase } = await requireUser();
  let deleted = 0;
  for (let index = 0; index < unique.length; index += 100) {
    const chunk = unique.slice(index, index + 100);
    const children = await Promise.all([
      supabase.from("outreach_jobs").delete().in("prospect_id", chunk),
      supabase.from("follow_ups").delete().in("prospect_id", chunk),
      supabase.from("activity_log").delete().in("prospect_id", chunk),
      supabase.from("ai_usage").delete().in("prospect_id", chunk),
    ]);
    const childError = children.find((result) => result.error)?.error;
    if (childError) return { ok: false, error: childError.message };
    const removed = await supabase.from("prospects").delete({ count: "exact" }).in("id", chunk);
    if (removed.error) return { ok: false, error: removed.error.message };
    deleted += removed.count ?? 0;
  }
  revalidateProspectPaths(unique);
  return { ok: true, message: `${deleted} deleted. 0 failed.` };
}

export async function deleteSuppressions(usernames: string[]): Promise<ActionResult> {
  const unique = [...new Set(usernames.map((name) => name.replace(/^@/, "").trim().toLowerCase()).filter(Boolean))];
  if (unique.length === 0) return { ok: false, error: "Choose at least one suppression." };
  const { supabase } = await requireUser();
  const { error } = await supabase.from("discovery_suppressions").delete().in("instagram_username_normalized", unique);
  if (error) return { ok: false, error: error.message };
  revalidateProspectPaths([]);
  return { ok: true, message: "Suppression removed. The account may be rediscovered." };
}

export async function clearMessageOverride(id: string): Promise<ActionResult> {
  if (!isUuid(id)) return { ok: false, error: "That prospect could not be found." };
  const { supabase } = await requireUser();
  const result = await saveMessageOverride(supabase, id, null);
  if (!result.ok) return result;
  revalidateProspectPaths([id]);
  return { ok: true };
}
