import { createAdminClient } from "@/lib/supabase/admin";
import { applyWorkerCommand } from "@/lib/worker/command-apply";
import { isWorkerAuthorized, workerError, workerUnauthorized } from "@/lib/worker/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isWorkerAuthorized(request)) return workerUnauthorized();
  const admin = createAdminClient();
  if (!admin) return workerError(500, "Worker API is not configured.");
  const result = await applyWorkerCommand(admin, "stop_discovery", {});
  if (!result.ok) return workerError(500, result.error);
  return Response.json({ ok: true });
}
