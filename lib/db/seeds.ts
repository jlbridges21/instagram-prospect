import "server-only";

import type { ProspectSource, ProspectStatus } from "@/lib/constants/prospects";
import { PRE_SCORE_BANDS, qualityYield, summarizeScoreMix } from "@/lib/discovery/quality";
import { exampleFromProspect, learnQualityModel, type LearnedToken } from "@/lib/discovery/learned-quality";
import { clampTuning, effectiveKeywordList, DEFAULT_POSITIVE_KEYWORDS, LEGACY_POSITIVE_KEYWORDS } from "@/lib/discovery/defaults";
import { suggestPositiveKeywords } from "@/lib/discovery/keyword-suggestions";
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

export async function suggestedDiscoveryKeywords() {
  const supabase = await createClient();
  const [settings, rows] = await Promise.all([
    supabase.from("settings").select("discovery_positive_keywords, discovery_ignored_keywords, discovery_tuning").eq("id", 1).maybeSingle(),
    supabase.from("prospects").select("instagram_username, display_name, bio, category, status").in("status", ["approved", "contacted", "skipped", "disqualified"]).limit(400),
  ]);
  if (rows.error || !rows.data) return [] as string[];
  const tuning = clampTuning(settings.data?.discovery_tuning);
  const ignored = settings.error ? [] : settings.data?.discovery_ignored_keywords ?? [];
  return suggestPositiveKeywords({
    observations: rows.data.flatMap((row) => {
      if (row.status !== "approved" && row.status !== "contacted" && row.status !== "skipped" && row.status !== "disqualified") return [];
      return [{
        status: row.status,
        text: [row.instagram_username, row.display_name, row.bio, row.category].filter((value): value is string => Boolean(value)).join(" "),
      }];
    }),
    existingKeywords: effectiveKeywordList(settings.data?.discovery_positive_keywords, DEFAULT_POSITIVE_KEYWORDS, LEGACY_POSITIVE_KEYWORDS),
    ignored,
    minimum: tuning.keywordSuggestionMinimum,
  });
}

export async function discoveryOutcomeWindow(since: string | null, until: string | null = null) {
  const supabase = await createClient();
  const [inspected, review, approved] = await Promise.all([
    outcomeCount(supabase, null, since, until),
    outcomeCount(supabase, REVIEW_STATUSES, since, until),
    outcomeCount(supabase, APPROVED_STATUSES, since, until),
  ]);
  return qualityYield({ inspected, review, approved });
}

export async function optimizationStartedAt() {
  const supabase = await createClient();
  const row = await supabase.from("settings").select("discovery_optimization_started_at").eq("id", 1).maybeSingle();
  if (row.error) return null;
  return row.data?.discovery_optimization_started_at ?? null;
}

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
  const scoreRows = await supabase.from("prospects").select("discovery_pre_score").not("discovery_pre_score", "is", null).limit(1000);
  const mix = scoreRows.error ? null : summarizeScoreMix((scoreRows.data ?? []).flatMap((row) => typeof row.discovery_pre_score === "number" ? [row.discovery_pre_score] : []));
  return {
    collected: funnel?.collected ?? null,
    deferred: funnel?.deferred ?? null,
    opened,
    review,
    reviewPerOpened: reviewYield(opened, review),
    reviewPerCollected: funnel ? reviewYield(funnel.collected, review) : null,
    bands,
    mix,
  };
}

export async function learnedSignalView() {
  const supabase = await createClient();
  const settings = await supabase.from("settings").select("discovery_ignored_keywords, discovery_tuning").eq("id", 1).maybeSingle();
  const rows = [];
  let from = 0;
  for (;;) {
    const page = await supabase.from("prospects").select("instagram_username, status, discovery_priority_reason, is_sample").order("discovered_at", { ascending: false }).range(from, from + 999);
    if (page.error || !page.data) return null;
    rows.push(...page.data);
    if (page.data.length < 1000) break;
    from += 1000;
  }
  const tuning = clampTuning(settings.data?.discovery_tuning);
  const ignored = settings.error ? [] : settings.data?.discovery_ignored_keywords ?? [];
  const model = learnQualityModel({
    examples: rows.flatMap((row) => {
      const example = exampleFromProspect(row);
      return example ? [example] : [];
    }),
    minimum: tuning.learnedTokenMinimum,
    strength: tuning.learnedSmoothing,
    ignored,
  });
  const ignoredSet = new Set(model.ignored);
  const active = model.tokens.filter((token) => token.active && !ignoredSet.has(token.token));
  const positive = active
    .filter((token) => token.smoothedRate > model.globalPositiveRate)
    .sort((left, right) => right.positiveRate - left.positiveRate || right.sampleSize - left.sampleSize)
    .slice(0, 12);
  const negative = active
    .filter((token) => token.smoothedRate < model.globalPositiveRate)
    .sort((left, right) => left.positiveRate - right.positiveRate || right.sampleSize - left.sampleSize)
    .slice(0, 8);
  const held = model.tokens.filter((token) => token.active && ignoredSet.has(token.token)).slice(0, 12);
  const waiting = model.tokens.filter((token) => !token.active && token.sampleSize >= 5 && !ignoredSet.has(token.token)).slice(0, 8);
  return {
    positive,
    negative,
    held,
    waiting,
    positiveExamples: model.positiveExamples,
    negativeExamples: model.negativeExamples,
    minimum: model.minimum,
  };
}

export type LearnedSignalView = {
  positive: LearnedToken[];
  negative: LearnedToken[];
  held: LearnedToken[];
  waiting: LearnedToken[];
  positiveExamples: number;
  negativeExamples: number;
  minimum: number;
};

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

async function outcomeCount(
  supabase: Awaited<ReturnType<typeof createClient>>,
  statuses: readonly ProspectStatus[] | null,
  since: string | null,
  until: string | null = null,
) {
  let query = supabase.from("prospects").select("id", { count: "exact", head: true });
  if (statuses) query = query.in("status", [...statuses]);
  if (since) query = query.gte("discovered_at", since);
  if (until) query = query.lt("discovered_at", until);
  const result = await query;
  if (result.error) return 0;
  return result.count ?? 0;
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
