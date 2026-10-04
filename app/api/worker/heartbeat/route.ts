import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { isWorkerAuthorized, workerError, workerUnauthorized } from "@/lib/worker/auth";
import { offerWorkerCommand, recordWorkerEvent } from "@/lib/worker/command-service";

export const runtime = "nodejs";

const heartbeatSchema = z.object({
  worker_id: z.string().trim().min(1).max(120),
  machine_name: z.string().trim().max(200).optional(),
  platform: z.enum(["darwin", "win32", "linux"]).optional(),
  hostname: z.string().trim().max(200).optional(),
  status: z.enum(["online", "offline", "error", "attention_required"]).optional(),
  current_task: z.string().trim().max(500).nullable().optional(),
  browser_connected: z.boolean().optional(),
  instagram_authenticated: z.boolean().optional(),
  attention_reason: z.string().trim().max(500).nullable().optional(),
  profiles_seen: z.number().int().min(0).max(100_000).optional(),
  profiles_ingested: z.number().int().min(0).max(100_000).optional(),
  profiles_excluded_following: z.number().int().min(0).max(100_000).optional(),
  profiles_qualified: z.number().int().min(0).max(100_000).optional(),
  session_errors: z.number().int().min(0).max(100_000).optional(),
  current_username: z.string().trim().max(80).nullable().optional(),
  last_event: z.string().trim().max(300).nullable().optional(),
  new_session: z.boolean().optional(),
  version: z.string().trim().max(20).optional(),
});

export async function POST(request: Request) {
  if (!isWorkerAuthorized(request)) return workerUnauthorized();

  const admin = createAdminClient();
  if (!admin) return workerError(500, "Worker API is not configured.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return workerError(400, "Request body must be JSON.");
  }

  const parsed = heartbeatSchema.safeParse(body);
  if (!parsed.success) {
    return workerError(400, parsed.error.issues.map((issue) => issue.message).join(" "));
  }

  const now = new Date().toISOString();
  const { data: existing, error: readError } = await admin
    .from("worker_instances")
    .select("id, started_at")
    .eq("worker_id", parsed.data.worker_id)
    .maybeSingle();

  if (readError) return workerError(500, "Could not read the worker record.");

  const requestedStatus = parsed.data.status ?? "online";
  const basePatch = {
    worker_id: parsed.data.worker_id,
    machine_name: parsed.data.machine_name ?? null,
    platform: parsed.data.platform ?? null,
    hostname: parsed.data.hostname ?? null,
    status: requestedStatus,
    current_task: parsed.data.current_task ?? null,
    browser_connected: parsed.data.browser_connected ?? false,
    instagram_authenticated: parsed.data.instagram_authenticated ?? false,
    last_heartbeat_at: now,
    started_at: existing?.started_at ?? now,
  };
  const extendedPatch = {
    ...basePatch,
    attention_reason: parsed.data.attention_reason ?? null,
    profiles_seen: parsed.data.profiles_seen ?? 0,
    profiles_ingested: parsed.data.profiles_ingested ?? 0,
    profiles_excluded_following: parsed.data.profiles_excluded_following ?? 0,
    profiles_qualified: parsed.data.profiles_qualified ?? 0,
    session_errors: parsed.data.session_errors ?? 0,
    current_username: parsed.data.current_username ?? null,
    last_event: parsed.data.last_event ?? null,
  };

  const writeExtended = existing
    ? await admin.from("worker_instances").update(extendedPatch).eq("id", existing.id)
    : await admin.from("worker_instances").insert(extendedPatch);

  if (writeExtended.error) {
    const counterPatch = {
      ...basePatch,
      attention_reason: parsed.data.attention_reason ?? null,
      profiles_seen: parsed.data.profiles_seen ?? 0,
      profiles_ingested: parsed.data.profiles_ingested ?? 0,
      profiles_excluded_following: parsed.data.profiles_excluded_following ?? 0,
      profiles_qualified: parsed.data.profiles_qualified ?? 0,
    };
    const writeCounters = existing
      ? await admin.from("worker_instances").update(counterPatch).eq("id", existing.id)
      : await admin.from("worker_instances").insert(counterPatch);
    if (writeCounters.error) {
      const compatible = compatibleHeartbeat(basePatch, writeExtended.error.message);
      const writeBase = existing
        ? await admin.from("worker_instances").update(compatible).eq("id", existing.id)
        : await admin.from("worker_instances").insert(compatible);
      if (writeBase.error) return workerError(500, "Could not store the heartbeat.");
    }
  }

  await touchSession(admin, parsed.data, requestedStatus, now).catch(() => undefined);
  if (parsed.data.new_session && parsed.data.version) {
    await recordWorkerEvent(admin, {
      workerId: parsed.data.worker_id,
      eventType: "worker_connected",
      message: "Worker connected.",
      metadata: { version: parsed.data.version },
    }).catch(() => undefined);
  }
  const nextCommand = await offerWorkerCommand(admin, parsed.data.worker_id).catch(() => null);

  return Response.json({ ok: true, next_command: nextCommand });
}

function compatibleHeartbeat<T extends { status: string; current_task: string | null }>(
  patch: T,
  message: string,
) {
  if (patch.status !== "attention_required") return patch;
  if (!/status|check|attention/i.test(message)) return patch;
  return {
    ...patch,
    status: "error" as const,
    current_task: patch.current_task ? `attention_required:${patch.current_task}` : "attention_required",
  };
}

async function touchSession(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  data: z.infer<typeof heartbeatSchema>,
  status: string,
  now: string,
) {
  const sessionStatus: "running" | "stopped" | "attention_required" | "error" =
    status === "offline"
      ? "stopped"
      : status === "attention_required"
        ? "attention_required"
        : status === "error"
          ? "error"
          : "running";
  const counters = {
    profiles_seen: data.profiles_seen ?? 0,
    profiles_ingested: data.profiles_ingested ?? 0,
    profiles_excluded_following: data.profiles_excluded_following ?? 0,
    profiles_qualified: data.profiles_qualified ?? 0,
    last_error: data.attention_reason ?? null,
    errors: data.session_errors ?? 0,
    status: sessionStatus,
  };
  const { data: open, error } = await admin
    .from("worker_sessions")
    .select("id, profiles_seen, profiles_ingested, profiles_excluded_following, profiles_qualified, errors, status, last_error")
    .eq("worker_id", data.worker_id)
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return;
  const unchanged = open
    && open.profiles_seen === counters.profiles_seen
    && open.profiles_ingested === counters.profiles_ingested
    && open.profiles_excluded_following === counters.profiles_excluded_following
    && open.profiles_qualified === counters.profiles_qualified
    && open.errors === counters.errors
    && open.status === counters.status
    && (open.last_error ?? null) === counters.last_error;
  if (open && unchanged && !data.new_session && sessionStatus !== "stopped") return;
  if (data.new_session && open) {
    await admin.from("worker_sessions").update({ status: "stopped", ended_at: now }).eq("id", open.id);
    if (sessionStatus === "stopped") return;
    await admin.from("worker_sessions").insert({ worker_id: data.worker_id, ...counters });
    return;
  }
  if (open && sessionStatus === "stopped") {
    await admin.from("worker_sessions").update({ ...counters, ended_at: now }).eq("id", open.id);
    return;
  }
  if (open) {
    await admin.from("worker_sessions").update(counters).eq("id", open.id);
    return;
  }
  if (sessionStatus !== "stopped") {
    await admin.from("worker_sessions").insert({ worker_id: data.worker_id, ...counters });
  }
}
