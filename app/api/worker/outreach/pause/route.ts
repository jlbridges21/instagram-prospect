import { setAutomation } from "@/lib/outreach/service";
import { createAdminClient } from "@/lib/supabase/admin";
import { isWorkerAuthorized, workerError, workerUnauthorized } from "@/lib/worker/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isWorkerAuthorized(request)) return workerUnauthorized();
  const admin = createAdminClient();
  if (!admin) return workerError(500, "Worker API is not configured.");
  const paused = await setAutomation(admin, false, "worker", false);
  if (!paused.ok) return workerError(500, paused.error);
  return Response.json({ ok: true, message: "Outreach paused — Instagram Follow action restricted" });
}
