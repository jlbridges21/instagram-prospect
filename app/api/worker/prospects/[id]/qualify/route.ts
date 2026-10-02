import { qualifyStoredProspect } from "@/lib/ai/persist";
import { appSettingsFromRow, targetingFromRow } from "@/lib/db/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/utils/format";
import { isWorkerAuthorized, workerError, workerUnauthorized } from "@/lib/worker/auth";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isWorkerAuthorized(request)) return workerUnauthorized();
  const { id } = await params;
  if (!isUuid(id)) return workerError(400, "That prospect could not be found.");

  const admin = createAdminClient();
  if (!admin) return workerError(500, "Worker API is not configured.");

  const prospect = await admin
    .from("prospects")
    .select("id, already_following, status")
    .eq("id", id)
    .maybeSingle();
  if (prospect.error) return workerError(500, "Could not load the prospect.");
  if (!prospect.data) return workerError(404, "That prospect could not be found.");
  if (prospect.data.already_following || prospect.data.status === "disqualified") {
    return Response.json({ ok: true, skipped: true, reason: "already_following" });
  }

  const [settingsResult, targetingResult] = await Promise.all([
    admin.from("settings").select("*").eq("id", 1).maybeSingle(),
    admin.from("targeting_settings").select("*").eq("id", 1).maybeSingle(),
  ]);
  if (settingsResult.error || !settingsResult.data || targetingResult.error || !targetingResult.data) {
    return workerError(500, "Could not load qualification settings.");
  }

  const qualified = await qualifyStoredProspect(
    admin,
    id,
    appSettingsFromRow(settingsResult.data),
    targetingFromRow(targetingResult.data),
    { actor: "worker" },
  );
  if (!qualified.ok) return workerError(500, qualified.error);

  return Response.json({
    ok: true,
    skipped: false,
    status: qualified.result.decision.status,
    fitLabel: qualified.result.decision.fitLabel,
    qualified: qualified.result.decision.qualified,
    approved: false,
  });
}
