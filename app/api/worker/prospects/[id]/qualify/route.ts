import { qualifyStoredProspect } from "@/lib/ai/persist";
import { recordQualificationSeedEffects } from "@/lib/discovery/promotion";
import { appSettingsFromRow, targetingFromRow } from "@/lib/db/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/utils/format";
import { isWorkerAuthorized, workerError, workerUnauthorized } from "@/lib/worker/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

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
  if (!qualified.ok) {
    await admin
      .from("prospects")
      .update({ qualification_error: qualified.error.slice(0, 500) })
      .eq("id", id)
      .then(() => undefined, () => undefined);
    return workerError(500, qualified.error);
  }

  await admin.from("prospects").update({ qualification_error: null }).eq("id", id);
  const decision = qualified.result.decision;
  const settings = appSettingsFromRow(settingsResult.data);
  await recordQualificationSeedEffects(admin, id, {
    cached: qualified.result.cached,
    qualified: decision.qualified,
    fitScore: decision.fitScore,
    fitLabel: decision.fitLabel,
    status: decision.status,
    settings: settings.optimization,
  }).catch(() => undefined);
  const seedCredit = await seedCreditForProspect(admin, id);
  return Response.json({
    ok: true,
    skipped: false,
    cached: qualified.result.cached,
    prospectId: id,
    username: seedCredit?.prospectUsername ?? undefined,
    qualified: decision.qualified,
    fitScore: decision.fitScore,
    fitLabel: decision.fitLabel,
    status: decision.status,
    category: decision.category,
    approved: false,
    seedCredit: seedCredit
      ? { username: seedCredit.username, inspected: seedCredit.inspected, review: seedCredit.review }
      : null,
  });
}

async function seedCreditForProspect(admin: NonNullable<ReturnType<typeof createAdminClient>>, prospectId: string) {
  const prospect = await admin
    .from("prospects")
    .select("instagram_username, source_seed_id")
    .eq("id", prospectId)
    .maybeSingle();
  if (prospect.error || !prospect.data?.source_seed_id) return null;
  const seed = await admin
    .from("discovery_seeds")
    .select("instagram_username, profiles_inspected, profiles_reaching_review")
    .eq("id", prospect.data.source_seed_id)
    .maybeSingle();
  if (seed.error || !seed.data) return null;
  return {
    prospectUsername: prospect.data.instagram_username,
    username: seed.data.instagram_username,
    inspected: seed.data.profiles_inspected,
    review: seed.data.profiles_reaching_review,
  };
}
