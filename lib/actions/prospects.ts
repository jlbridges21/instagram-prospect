"use server";

import { revalidatePath } from "next/cache";
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

export async function clearMessageOverride(id: string): Promise<ActionResult> {
  if (!isUuid(id)) return { ok: false, error: "That prospect could not be found." };
  const { supabase } = await requireUser();
  const result = await saveMessageOverride(supabase, id, null);
  if (!result.ok) return result;
  revalidateProspectPaths([id]);
  return { ok: true };
}
