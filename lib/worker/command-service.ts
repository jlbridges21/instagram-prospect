import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { isMissingRelation } from "@/lib/db/errors";
import { applyWorkerCommand } from "@/lib/worker/command-apply";
import {
  claimAllowed,
  commandIdempotencyKey,
  commandPriority,
  parseWorkerCommand,
  type WorkerCommandType,
} from "@/lib/worker/commands";

type Client = SupabaseClient<Database>;

const CONTROL = new Set<WorkerCommandType>(["start_discovery", "pause_discovery", "stop_discovery", "start_outreach", "pause_outreach"]);

export async function enqueueWorkerCommand(
  supabase: Client,
  input: { type: unknown; payload?: unknown; workerId?: string | null; requestedBy?: string | null },
) {
  const parsed = parseWorkerCommand({ type: input.type, payload: input.payload });
  if (!parsed.ok) return parsed;
  const payload = parsed.payload as Record<string, unknown>;
  const idempotencyKey = commandIdempotencyKey(parsed.type, payload);
  if (idempotencyKey) {
    const existing = await supabase
      .from("worker_commands")
      .select("id, status")
      .eq("idempotency_key", idempotencyKey)
      .in("status", ["queued", "claimed", "running"])
      .limit(1)
      .maybeSingle();
    if (existing.data) return { ok: true as const, id: existing.data.id, duplicate: true as const };
  }
  const now = Date.now();
  const inserted = await supabase.from("worker_commands").insert({
    worker_id: input.workerId ?? null,
    command_type: parsed.type,
    payload: payload as Database["public"]["Tables"]["worker_commands"]["Insert"]["payload"],
    status: "queued",
    priority: commandPriority(parsed.type),
    idempotency_key: idempotencyKey,
    requested_by: input.requestedBy ?? null,
    created_by_source: "dashboard",
    expires_at: new Date(now + 3 * 60_000).toISOString(),
  }).select("id").single();
  if (inserted.error) {
    if (isMissingRelation(inserted.error)) return { ok: false as const, error: "Run the worker command migration, then try again." };
    return { ok: false as const, error: inserted.error.message };
  }
  await recordWorkerEvent(supabase, {
    workerId: input.workerId ?? null,
    eventType: "command_queued",
    message: `${parsed.type.replaceAll("_", " ")} is waiting for the worker.`,
  });
  return { ok: true as const, id: inserted.data.id, duplicate: false as const };
}

export async function offerWorkerCommand(admin: Client, workerId: string) {
  await expireWorkerCommands(admin);
  const { data, error } = await admin
    .from("worker_commands")
    .select("id, worker_id, command_type, payload, status, priority")
    .eq("status", "queued")
    .or(`worker_id.is.null,worker_id.eq.${workerId}`)
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(5);
  if (error || !data) return null;
  const next = data.find((row) => claimAllowed({ commandWorkerId: row.worker_id, requesterId: workerId, status: row.status }));
  if (!next) return null;
  return { commandId: next.id, type: next.command_type, payload: next.payload ?? {} };
}

export async function claimWorkerCommand(admin: Client, workerId: string, commandId: string) {
  const current = await admin.from("worker_commands").select("id, worker_id, command_type, payload, status").eq("id", commandId).maybeSingle();
  if (current.error || !current.data) return { ok: false as const, error: "Command was not found." };
  if (!claimAllowed({ commandWorkerId: current.data.worker_id, requesterId: workerId, status: current.data.status })) {
    return { ok: false as const, error: "This worker cannot claim that command." };
  }
  const now = new Date().toISOString();
  const claimed = await admin
    .from("worker_commands")
    .update({ status: "running", worker_id: workerId, claimed_at: now, started_at: now, expires_at: null })
    .eq("id", commandId)
    .eq("status", "queued")
    .select("id, command_type, payload")
    .maybeSingle();
  if (claimed.error || !claimed.data) return { ok: false as const, error: "Command was already taken." };
  const type = claimed.data.command_type as WorkerCommandType;
  const payload = isRecord(claimed.data.payload) ? claimed.data.payload : {};
  if (CONTROL.has(type)) {
    const applied = await applyWorkerCommand(admin, type, payload);
    if (!applied.ok) {
      await failWorkerCommand(admin, workerId, commandId, "command_failed", applied.error);
      return applied;
    }
  }
  await recordWorkerEvent(admin, { workerId, eventType: "command_started", message: `${type.replaceAll("_", " ")} started.` });
  return { ok: true as const, type, payload, applied: CONTROL.has(type) };
}

export async function completeWorkerCommand(admin: Client, workerId: string, commandId: string, result: Record<string, unknown>) {
  const now = new Date().toISOString();
  const { error } = await admin
    .from("worker_commands")
    .update({ status: "completed", completed_at: now, result: result as Database["public"]["Tables"]["worker_commands"]["Update"]["result"] })
    .eq("id", commandId)
    .eq("worker_id", workerId)
    .in("status", ["running", "claimed"]);
  if (error) return { ok: false as const, error: error.message };
  await recordWorkerEvent(admin, { workerId, eventType: "command_completed", message: "Command completed.", metadata: result });
  return { ok: true as const };
}

export async function failWorkerCommand(admin: Client, workerId: string, commandId: string, errorCode: string, errorMessage: string) {
  const now = new Date().toISOString();
  await admin
    .from("worker_commands")
    .update({ status: "failed", failed_at: now, error_code: errorCode, error_message: errorMessage.slice(0, 500) })
    .eq("id", commandId)
    .eq("worker_id", workerId);
  await recordWorkerEvent(admin, { workerId, eventType: "command_failed", message: errorMessage.slice(0, 240) });
  return { ok: true as const };
}

export async function cancelWorkerCommand(supabase: Client, commandId: string) {
  const { data, error } = await supabase
    .from("worker_commands")
    .update({ status: "cancelled" })
    .eq("id", commandId)
    .eq("status", "queued")
    .select("id")
    .maybeSingle();
  if (error) return { ok: false as const, error: error.message };
  if (!data) return { ok: false as const, error: "Only a command that has not started can be cancelled." };
  return { ok: true as const };
}

export async function expireWorkerCommands(admin: Client) {
  const now = new Date().toISOString();
  await admin
    .from("worker_commands")
    .update({ status: "expired", error_message: "Command expired because the worker did not respond." })
    .eq("status", "queued")
    .lt("expires_at", now);
  const stale = new Date(Date.now() - 20 * 60_000).toISOString();
  await admin
    .from("worker_commands")
    .update({
      status: "failed",
      failed_at: now,
      error_code: "worker_restarted",
      error_message: "The worker restarted before this command finished.",
    })
    .eq("status", "running")
    .lt("started_at", stale);
}

export async function recordWorkerEvent(
  supabase: Client,
  input: { workerId: string | null; eventType: string; message: string; metadata?: Record<string, unknown> },
) {
  await supabase.from("worker_events").insert({
    worker_id: input.workerId,
    event_type: input.eventType,
    message: input.message.slice(0, 240),
    metadata: (input.metadata ?? {}) as Database["public"]["Tables"]["worker_events"]["Insert"]["metadata"],
  });
  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  await supabase.from("worker_events").delete().lt("created_at", cutoff);
}

export async function listWorkerEvents(supabase: Client) {
  const { data, error } = await supabase
    .from("worker_events")
    .select("id, event_type, message, created_at")
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) return [];
  return data ?? [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
