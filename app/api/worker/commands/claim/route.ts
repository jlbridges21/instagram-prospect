import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { claimWorkerCommand } from "@/lib/worker/command-service";
import { isWorkerAuthorized, workerError, workerUnauthorized } from "@/lib/worker/auth";

export const runtime = "nodejs";

const schema = z.object({
  worker_id: z.string().trim().min(1).max(120),
  command_id: z.string().uuid(),
});

export async function POST(request: Request) {
  if (!isWorkerAuthorized(request)) return workerUnauthorized();
  const admin = createAdminClient();
  if (!admin) return workerError(500, "Worker API is not configured.");
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return workerError(400, "Command claim is not valid.");
  const result = await claimWorkerCommand(admin, parsed.data.worker_id, parsed.data.command_id);
  if (!result.ok) return workerError(409, result.error);
  return Response.json(result);
}
