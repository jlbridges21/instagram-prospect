import { shouldSkipKnownProspect } from "@/lib/prospects/discovery-check";
import { normalizeUsername } from "@/lib/utils/format";
import { createAdminClient } from "@/lib/supabase/admin";
import { isWorkerAuthorized, workerError, workerUnauthorized } from "@/lib/worker/auth";

export const runtime = "nodejs";

const USERNAME_PATTERN = /^[a-z0-9._]{1,30}$/;

export async function GET(request: Request) {
  if (!isWorkerAuthorized(request)) return workerUnauthorized();

  const admin = createAdminClient();
  if (!admin) return workerError(500, "Worker API is not configured.");

  const username = normalizeUsername(new URL(request.url).searchParams.get("username") ?? "");
  if (!USERNAME_PATTERN.test(username)) return workerError(400, "Username is not valid.");

  const [prospectResult, settingsResult] = await Promise.all([
    admin
      .from("prospects")
      .select("id, status, already_contacted, already_following, discovered_at, ai_analyzed_at")
      .eq("instagram_username", username)
      .maybeSingle(),
    admin.from("settings").select("discovery_duplicate_cooldown_days").eq("id", 1).maybeSingle(),
  ]);

  if (prospectResult.error) return workerError(500, "Could not check that username.");

  const row = prospectResult.data;
  const cooldown = settingsResult.data?.discovery_duplicate_cooldown_days ?? 30;
  const exists = Boolean(row);
  const skip = shouldSkipKnownProspect({
    exists,
    status: row?.status ?? null,
    alreadyFollowing: row?.already_following ?? false,
    alreadyContacted: row?.already_contacted ?? false,
    discoveredAt: row?.discovered_at ?? null,
    analyzed: Boolean(row?.ai_analyzed_at),
    cooldownDays: cooldown,
  });

  return Response.json({
    exists,
    prospectId: row?.id ?? null,
    status: row?.status ?? null,
    alreadyContacted: row?.already_contacted ?? false,
    alreadyFollowing: row?.already_following ?? false,
    discoveredAt: row?.discovered_at ?? null,
    skip,
  });
}
