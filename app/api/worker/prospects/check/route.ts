import { shouldSkipKnownProspect } from "@/lib/prospects/discovery-check";
import { normalizeUsername } from "@/lib/utils/format";
import { createAdminClient } from "@/lib/supabase/admin";
import { isWorkerAuthorized, workerError, workerUnauthorized } from "@/lib/worker/auth";

export const runtime = "nodejs";

const USERNAME_PATTERN = /^[a-z0-9._]{1,30}$/;

type CheckRow = {
  id: string;
  instagram_username: string;
  status: string | null;
  already_following: boolean | null;
  already_contacted: boolean | null;
  follow_relationship?: string | null;
  fit_label: string | null;
  discovered_at: string | null;
  ai_analyzed_at: string | null;
};

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
  const usernames = Array.isArray((body as { usernames?: unknown }).usernames)
    ? (body as { usernames: unknown[] }).usernames
    : null;
  if (!usernames) return workerError(400, "Usernames are required.");
  const normalized = [...new Set(usernames.map((value) => normalizeUsername(String(value))).filter((value) => USERNAME_PATTERN.test(value)))].slice(0, 25);
  if (normalized.length === 0) return Response.json({ results: [] });

  const settingsResult = await admin.from("settings").select("discovery_duplicate_cooldown_days").eq("id", 1).maybeSingle();
  const cooldown = settingsResult.data?.discovery_duplicate_cooldown_days ?? 30;
  const columns = "id, instagram_username, status, already_following, already_contacted, follow_relationship, fit_label, discovered_at, ai_analyzed_at";
  const first = await admin.from("prospects").select(columns).in("instagram_username", normalized);
  const prospectResult = first.error && /follow_relationship/i.test(first.error.message)
    ? await admin
      .from("prospects")
      .select("id, instagram_username, status, already_following, already_contacted, fit_label, discovered_at, ai_analyzed_at")
      .in("instagram_username", normalized)
    : first;
  if (prospectResult.error) return workerError(500, "Could not check those usernames.");

  const byUsername = new Map((prospectResult.data ?? []).map((row) => [row.instagram_username, row as CheckRow]));
  return Response.json({
    results: normalized.map((username) => {
      const row = byUsername.get(username);
      const skip = shouldSkipKnownProspect({
        exists: Boolean(row),
        status: row?.status ?? null,
        alreadyFollowing: row?.already_following ?? false,
        alreadyContacted: row?.already_contacted ?? false,
        discoveredAt: row?.discovered_at ?? null,
        analyzed: Boolean(row?.ai_analyzed_at),
        cooldownDays: cooldown,
      });
      return {
        username,
        exists: Boolean(row),
        prospectId: row?.id ?? null,
        status: row?.status ?? null,
        alreadyFollowing: row?.already_following ?? false,
        followRelationship: "follow_relationship" in (row ?? {}) ? (row as { follow_relationship?: string | null }).follow_relationship ?? null : null,
        fitLabel: row?.fit_label ?? null,
        discoveredAt: row?.discovered_at ?? null,
        skip,
      };
    }),
  });
}
