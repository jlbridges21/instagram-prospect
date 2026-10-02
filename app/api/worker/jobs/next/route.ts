import { appSettingsFromRow } from "@/lib/db/settings";
import { claimNextJob } from "@/lib/outreach/service";
import { claimJobSchema } from "@/lib/outreach/schemas";
import { createAdminClient } from "@/lib/supabase/admin";
import { isWorkerAuthorized, workerError, workerUnauthorized } from "@/lib/worker/auth";

export const runtime = "nodejs";

const nextCheckAfterSeconds = 30;

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

  const parsed = claimJobSchema.safeParse(body);
  if (!parsed.success) return workerError(400, "worker_id is required.");

  const settingsResult = await admin.from("settings").select("*").eq("id", 1).maybeSingle();
  if (settingsResult.error || !settingsResult.data) {
    return workerError(500, "Could not read outreach settings.");
  }
  const settings = appSettingsFromRow(settingsResult.data);

  const claimed = await claimNextJob({
    admin,
    workerId: parsed.data.worker_id,
    settings,
  });
  if (!claimed.ok) return workerError(500, claimed.error);
  if (!claimed.job) {
    return Response.json({
      job: null,
      reason: claimed.reason,
      nextCheckAfterSeconds,
    });
  }

  return Response.json({ job: claimed.job, nextCheckAfterSeconds: 0 });
}
