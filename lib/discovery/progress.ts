import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { discoveryStopDecision, type ReviewTarget } from "@/lib/discovery/policy";
import { isMissingRelation } from "@/lib/db/errors";
import type { Database } from "@/lib/db/types";
import { localDateKey } from "@/lib/outreach/time";

type Client = SupabaseClient<Database>;

export async function recordDiscoveryProgress(
  admin: Client,
  input: { inspections?: number; ai?: number; emptyCycles?: number },
) {
  const settings = await admin
    .from("settings")
    .select(
      "timezone, discovery_enabled, automation_enabled, discovery_review_target, discovery_session_inspection_cap, discovery_daily_inspection_cap, discovery_daily_ai_cap, discovery_stop_reason, discovery_auto_paused",
    )
    .eq("id", 1)
    .maybeSingle();
  if (settings.error || !settings.data) {
    if (
      !settings.error ||
      isMissingRelation(settings.error) ||
      /discovery_review_target|discovery_session_inspection_cap/i.test(settings.error.message)
    ) {
      return { ok: true as const, pause: false, reason: null, outreachEnabled: null };
    }
    return { ok: false as const, error: "Could not read discovery settings." };
  }

  const row = settings.data;
  const now = new Date();
  const date = localDateKey(now, row.timezone || "UTC");
  const inspections = Math.max(0, input.inspections ?? 0);
  const ai = Math.max(0, input.ai ?? 0);
  let dailyInspections = inspections;
  let dailyAi = ai;
  if (inspections > 0 || ai > 0) {
    const bumped = await admin.rpc("bump_discovery_usage", {
      p_date: date,
      p_inspections: inspections,
      p_ai: ai,
    });
    if (!bumped.error && bumped.data?.[0]) {
      dailyInspections = bumped.data[0].inspections;
      dailyAi = bumped.data[0].ai_qualifications;
    }
  } else {
    const usage = await admin
      .from("discovery_daily_usage")
      .select("inspections, ai_qualifications")
      .eq("usage_date", date)
      .maybeSingle();
    if (!usage.error && usage.data) {
      dailyInspections = usage.data.inspections;
      dailyAi = usage.data.ai_qualifications;
    }
  }

  const review = await admin
    .from("prospects")
    .select("id", { count: "exact", head: true })
    .eq("status", "review")
    .in("fit_label", ["strong_fit", "possible_fit"])
    .eq("is_sample", false);
  const currentReview = review.count ?? 0;
  const target: ReviewTarget = row.discovery_review_target == null ? "unlimited" : row.discovery_review_target;
  const session = await openSession(admin);
  const sessionInspections = (session?.profiles_inspected ?? 0) + inspections;
  const decision = discoveryStopDecision({
    currentReview,
    target,
    sessionInspections,
    sessionCap: row.discovery_session_inspection_cap ?? 1000,
    dailyInspections,
    dailyInspectionCap: row.discovery_daily_inspection_cap ?? 500,
    dailyAi,
    dailyAiCap: row.discovery_daily_ai_cap ?? 300,
    emptyCollectionCycles: input.emptyCycles ?? 0,
  });

  if (session) {
    await admin
      .from("discovery_sessions")
      .update({
        profiles_inspected: sessionInspections,
        ai_qualifications: (session.ai_qualifications ?? 0) + ai,
        last_candidate_at: inspections > 0 ? now.toISOString() : session.last_candidate_at,
        stopped_at: decision.pauseDiscovery ? now.toISOString() : null,
        stop_reason: decision.reason,
      })
      .eq("id", session.id);
  }

  if (decision.pauseDiscovery && row.discovery_enabled !== false) {
    await admin
      .from("settings")
      .update({
        discovery_enabled: false,
        discovery_auto_paused: true,
        discovery_stop_reason: decision.reason,
      })
      .eq("id", 1);
  }

  return {
    ok: true as const,
    pause: decision.pauseDiscovery,
    reason: decision.reason,
    currentReview,
    target,
    sessionInspections,
    dailyInspections,
    dailyAi,
    outreachEnabled: row.automation_enabled ?? false,
  };
}

async function openSession(admin: Client) {
  const { data, error } = await admin
    .from("discovery_sessions")
    .select("id, profiles_inspected, ai_qualifications, last_candidate_at")
    .is("stopped_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return data;
}

export async function startDiscoverySession(admin: Client, input: { target: number | null; reviewCount: number }) {
  await admin
    .from("discovery_sessions")
    .update({ stopped_at: new Date().toISOString(), stop_reason: "manual_pause" })
    .is("stopped_at", null);
  const { error } = await admin.from("discovery_sessions").insert({
    starting_review_count: input.reviewCount,
    target: input.target,
  });
  return { ok: !error };
}
