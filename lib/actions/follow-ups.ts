"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/actions/prospects";
import {
  cancelFollowUp,
  completeFollowUp,
  createFollowUp,
  updateFollowUp,
} from "@/lib/follow-ups/service";
import { requireUser } from "@/lib/supabase/auth";
import { isUuid } from "@/lib/utils/format";

function refresh(prospectId?: string) {
  revalidatePath("/follow-ups");
  revalidatePath("/");
  if (prospectId) revalidatePath(`/prospects/${prospectId}`);
}

export async function scheduleFollowUp(input: {
  prospectId: string;
  dueAt: string;
  notes: string;
}): Promise<ActionResult> {
  if (!isUuid(input.prospectId)) return { ok: false, error: "That prospect could not be found." };
  const { supabase, user } = await requireUser();
  const result = await createFollowUp(supabase, {
    ...input,
    actor: user.email ?? "authenticated user",
  });
  if (!result.ok) return result;
  refresh(input.prospectId);
  return { ok: true };
}

export async function editFollowUp(input: {
  id: string;
  prospectId: string;
  dueAt: string;
  notes: string;
}): Promise<ActionResult> {
  if (!isUuid(input.id)) return { ok: false, error: "That follow-up could not be found." };
  const { supabase } = await requireUser();
  const result = await updateFollowUp(supabase, input);
  if (!result.ok) return result;
  refresh(input.prospectId);
  return { ok: true };
}

export async function markFollowUpComplete(id: string, prospectId: string): Promise<ActionResult> {
  if (!isUuid(id)) return { ok: false, error: "That follow-up could not be found." };
  const { supabase, user } = await requireUser();
  const result = await completeFollowUp(supabase, id, user.email ?? "authenticated user");
  if (!result.ok) return result;
  refresh(prospectId);
  return { ok: true };
}

export async function markFollowUpCancelled(id: string, prospectId: string): Promise<ActionResult> {
  if (!isUuid(id)) return { ok: false, error: "That follow-up could not be found." };
  const { supabase } = await requireUser();
  const result = await cancelFollowUp(supabase, id);
  if (!result.ok) return result;
  refresh(prospectId);
  return { ok: true };
}
