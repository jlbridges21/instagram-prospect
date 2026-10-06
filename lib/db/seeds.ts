import "server-only";

import type { ProspectSource, ProspectStatus } from "@/lib/constants/prospects";
import { PRE_SCORE_BANDS } from "@/lib/discovery/quality";
import { reviewYield } from "@/lib/discovery/seeds";
import { databaseErrorMessage, isMissingRelation } from "@/lib/db/errors";
import type { DataResult } from "@/lib/db/models";
import type { DiscoverySeedRow } from "@/lib/db/types";
import { createClient } from "@/lib/supabase/server";

export async function seedExists(username: string): Promise<boolean | null> {
  const supabase = await createClient();
  const result = await supabase.from("discovery_seeds").select("id").eq("instagram_username", username).maybeSingle();
  if (result.error) return null;
  return Boolean(result.data);
}

export async function prospectSeedUsername(id: string): Promise<string | null> {
  const link = await prospectDiscoveryLink(id);
  return link?.source_seed_username ?? null;
}

export async function prospectDiscoveryLink(id: string) {
  const supabase = await createClient();
  const result = await supabase.from("prospects").select("source_seed_username, discovery_priority_label, discovery_priority_reason, discovery_pre_score").eq("id", id).maybeSingle();
  if (result.error && /discovery_pre_score/i.test(result.error.message)) {
    const fallback = await supabase.from("prospects").select("source_seed_username, discovery_priority_label, discovery_priority_reason").eq("id", id).maybeSingle();
    if (fallback.error) return null;
    return fallback.data ? { ...fallback.data, discovery_pre_score: null } : null;
  }
  if (result.error) return null;
  return result.data;
}

export async function listDiscoverySeeds(): Promise<DataResult<DiscoverySeedRow[]>> {
  const supabase = await createClient();
  const result = await supabase.from("discovery_seeds").select("*").order("is_active", { ascending: false }).order("profiles_reaching_review", { ascending: false }).limit(200);
  if (result.error) return { ok: false, error: databaseErrorMessage(result.error), missingTable: isMissingRelation(result.error) };
  return { ok: true, data: result.data ?? [] };
}

const SOURCE_GROUPS = [
  ["seed_suggestion", "Seed suggestions"],
  ["seed_network", "Seed network"],
  ["suggested_accounts", "Suggested Accounts"],
  ["home_feed", "Home Feed"],
] as const;

export async function discoverySourceStats(days: number | null) {
  const supabase = await createClient();
  const since = days ? new Date(Date.now() - days * 86400000).toISOString() : null;
  const rows = await Promise.all(SOURCE_GROUPS.map(async ([source, label]) => {
    const [inspected, review, approved] = await Promise.all([
      exactProspectCount(supabase, source, null, since),
      exactProspectCount(supabase, source, REVIEW_STATUSES, since),
      exactProspectCount(supabase, source, APPROVED_STATUSES, since),
    ]);
    return {
      source: label,
      inspected,
      review,
      approved,
      reviewYield: reviewYield(inspected, review),
      approvalYield: reviewYield(inspected, approved),
    };
  }));
  return rows;
}

export async function discoveryQualityStats(days: number | null) {
  const supabase = await createClient();
  const since = days ? new Date(Date.now() - days * 86400000).toISOString() : null;
  const bands = [];
  for (const band of PRE_SCORE_BANDS) {
    const [inspected, review] = await Promise.all([
      preScoreCount(supabase, band.min, band.max, false, since),
      preScoreCount(supabase, band.min, band.max, true, since),
    ]);
    if (inspected == null || review == null) return null;
    bands.push({ label: band.label, inspected, review, reviewYield: reviewYield(inspected, review) });
  }
  const opened = bands.reduce((sum, band) => sum + band.inspected, 0);
  const review = bands.reduce((sum, band) => sum + band.review, 0);
  const funnel = await funnelTotals(supabase, since);
  return {
    collected: funnel?.collected ?? null,
    deferred: funnel?.deferred ?? null,
    opened,
    review,
    reviewPerOpened: reviewYield(opened, review),
    reviewPerCollected: funnel ? reviewYield(funnel.collected, review) : null,
    bands,
  };
}

async function preScoreCount(
  supabase: Awaited<ReturnType<typeof createClient>>,
  min: number,
  max: number,
  reviewOnly: boolean,
  since: string | null,
) {
  let query = supabase.from("prospects").select("id", { count: "exact", head: true }).gte("discovery_pre_score", min).lte("discovery_pre_score", max);
  if (reviewOnly) query = query.in("status", [...REVIEW_STATUSES]);
  if (since) query = query.gte("discovered_at", since);
  const result = await query;
  if (result.error) return null;
  return result.count ?? 0;
}

async function funnelTotals(supabase: Awaited<ReturnType<typeof createClient>>, since: string | null) {
  let query = supabase.from("discovery_sessions").select("candidates_collected, candidates_deferred");
  if (since) query = query.gte("started_at", since);
  const result = await query;
  if (result.error) return null;
  return (result.data ?? []).reduce(
    (sum, row) => ({
      collected: sum.collected + (row.candidates_collected ?? 0),
      deferred: sum.deferred + (row.candidates_deferred ?? 0),
    }),
    { collected: 0, deferred: 0 },
  );
}

async function exactProspectCount(
  supabase: Awaited<ReturnType<typeof createClient>>,
  source: ProspectSource,
  statuses: readonly ProspectStatus[] | null,
  since: string | null,
) {
  let query = supabase.from("prospects").select("id", { count: "exact", head: true }).eq("source", source);
  if (statuses) query = query.in("status", [...statuses]);
  if (since) query = query.gte("discovered_at", since);
  const result = await query;
  if (result.error) return 0;
  return result.count ?? 0;
}

const REVIEW_STATUSES = ["review", "approved", "contacted", "replied", "follow_up", "demo_booked", "converted"] as const satisfies readonly ProspectStatus[];
const APPROVED_STATUSES = ["approved", "contacted", "replied", "follow_up", "demo_booked", "converted"] as const satisfies readonly ProspectStatus[];
