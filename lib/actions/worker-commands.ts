"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/actions/prospects";
import { requireUser } from "@/lib/supabase/auth";
import { cancelWorkerCommand, enqueueWorkerCommand } from "@/lib/worker/command-service";
import { COMMAND_LABELS, type WorkerCommandType } from "@/lib/worker/commands";

export async function requestWorkerCommand(type: WorkerCommandType, payload?: Record<string, unknown>): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  const result = await enqueueWorkerCommand(supabase, {
    type,
    payload: payload ?? {},
    requestedBy: user.email ?? "authenticated user",
  });
  if (!result.ok) return result;
  revalidatePath("/");
  revalidatePath("/worker");
  return {
    ok: true,
    message: result.duplicate ? `${COMMAND_LABELS[type]} is already waiting.` : `${COMMAND_LABELS[type]} sent to the worker.`,
  };
}

export async function cancelQueuedCommand(commandId: string): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const result = await cancelWorkerCommand(supabase, commandId);
  if (!result.ok) return result;
  revalidatePath("/worker");
  return { ok: true, message: "Command cancelled." };
}
