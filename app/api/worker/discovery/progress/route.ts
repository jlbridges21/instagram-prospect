import { recordDiscoveryProgress } from "@/lib/discovery/progress";
import { createAdminClient } from "@/lib/supabase/admin";
import { isWorkerAuthorized, workerError, workerUnauthorized } from "@/lib/worker/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isWorkerAuthorized(request)) return workerUnauthorized();
  const admin = createAdminClient();
  if (!admin) return workerError(500, "Worker API is not configured.");
  const body = (await request.json().catch(() => ({}))) as {
    inspections?: number;
    ai?: number;
    emptyCycles?: number;
  };
  const result = await recordDiscoveryProgress(admin, body);
  if (!result.ok) return workerError(500, result.error);
  return Response.json(result);
}
