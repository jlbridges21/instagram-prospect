import { previewNextJob, previewProspectSequence } from "@/lib/outreach/preview";
import { appSettingsFromRow } from "@/lib/db/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { isWorkerAuthorized, workerError, workerUnauthorized } from "@/lib/worker/auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isWorkerAuthorized(request)) return workerUnauthorized();
  const admin = createAdminClient();
  if (!admin) return workerError(500, "Worker API is not configured.");

  const settingsResult = await admin.from("settings").select("*").eq("id", 1).maybeSingle();
  if (settingsResult.error || !settingsResult.data) {
    return workerError(500, "Could not read outreach settings.");
  }

  const settings = appSettingsFromRow(settingsResult.data);
  const [preview, sequence] = await Promise.all([
    previewNextJob(admin, settings),
    previewProspectSequence(admin),
  ]);
  if (!preview.ok) return workerError(500, preview.error);
  if (!sequence.ok) return workerError(500, sequence.error);
  return Response.json({
    job: preview.job,
    reason: preview.reason,
    sequence: sequence.sequence,
    outreachPaused: !settings.outreach.automationEnabled,
  });
}
