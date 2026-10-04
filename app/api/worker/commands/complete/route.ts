import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { completeWorkerCommand, failWorkerCommand } from "@/lib/worker/command-service";
import { isWorkerAuthorized, workerError, workerUnauthorized } from "@/lib/worker/auth";

export const runtime = "nodejs";
const schema = z.object({
  worker_id: z.string().trim().min(1).max(120),
  command_id: z.string().uuid(),
  ok: z.boolean(),
  error_code: z.string().max(80).optional(),
  error_message: z.string().max(500).optional(),
  result: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: Request) {
  if (!isWorkerAuthorized(request)) return workerUnauthorized();
  const admin = createAdminClient();
  if (!admin) return workerError(500, "Worker API is not configured.");
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return workerError(400, "Command result is not valid.");
  const result = parsed.data.ok
    ? await completeWorkerCommand(admin, parsed.data.worker_id, parsed.data.command_id, parsed.data.result ?? {})
    : await failWorkerCommand(
        admin,
        parsed.data.worker_id,
        parsed.data.command_id,
        parsed.data.error_code ?? "command_failed",
        parsed.data.error_message ?? "The command failed.",
      );
  if (!result.ok) return workerError(500, result.error);
  return Response.json({ ok: true });
}
