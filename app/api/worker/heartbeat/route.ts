import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { isWorkerAuthorized, workerError, workerUnauthorized } from "@/lib/worker/auth";

export const runtime = "nodejs";

const heartbeatSchema = z.object({
  worker_id: z.string().trim().min(1).max(120),
  machine_name: z.string().trim().max(200).optional(),
  platform: z.enum(["darwin", "win32", "linux"]).optional(),
  hostname: z.string().trim().max(200).optional(),
  status: z.enum(["online", "offline", "error"]).optional(),
  current_task: z.string().trim().max(500).nullable().optional(),
  browser_connected: z.boolean().optional(),
  instagram_authenticated: z.boolean().optional(),
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

  const patch = {
    worker_id: parsed.data.worker_id,
    machine_name: parsed.data.machine_name ?? null,
    platform: parsed.data.platform ?? null,
    hostname: parsed.data.hostname ?? null,
    status: parsed.data.status ?? "online",
    current_task: parsed.data.current_task ?? null,
    browser_connected: parsed.data.browser_connected ?? false,
    instagram_authenticated: parsed.data.instagram_authenticated ?? false,
    last_heartbeat_at: now,
    started_at: existing?.started_at ?? now,
  };

  const write = existing
    ? await admin.from("worker_instances").update(patch).eq("id", existing.id)
    : await admin.from("worker_instances").insert(patch);

  if (write.error) return workerError(500, "Could not store the heartbeat.");

  return Response.json({ ok: true, workerId: parsed.data.worker_id, lastHeartbeatAt: now });
}
