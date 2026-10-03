import { previewLockedMessage, previewNextJob, previewProspectSequence } from "@/lib/outreach/preview";
import { appSettingsFromRow } from "@/lib/db/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { isWorkerAuthorized, workerError, workerUnauthorized } from "@/lib/worker/auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isWorkerAuthorized(request)) return workerUnauthorized();
  const admin = createAdminClient();
  if (!admin) return workerError(500, "Worker API is not configured.");

  const requestedUsername = new URL(request.url).searchParams.get("username");
  if (requestedUsername) {
    if (!/^[A-Za-z0-9._]{1,30}$/.test(requestedUsername.replace(/^@/, ""))) {
      return workerError(400, "Provide one Instagram username.");
    }
    const locked = await previewLockedMessage(admin, requestedUsername);
    if (!locked.ok) return workerError(500, locked.error);
    return Response.json({
      instagramUsername: locked.instagramUsername,
      message: locked.message,
    });
  }

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
