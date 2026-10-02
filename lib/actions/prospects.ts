"use server";

import { revalidatePath } from "next/cache";
import {
  changeProspectStatus,
  createManualProspect,
  saveMessageOverride,
  type ManualProspectInput,
} from "@/lib/prospects/service";
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
  ids.forEach((id) => revalidatePath(`/prospects/${id}`));
}

export async function approveProspects(ids: string[]): Promise<ActionResult> {
  return updateStatus(ids, "approved");
}

export async function skipProspects(ids: string[]): Promise<ActionResult> {
  return updateStatus(ids, "skipped");
}

export async function approveVisibleQueue(ids: string[]): Promise<ActionResult> {
  return updateStatus(ids, "approved");
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
