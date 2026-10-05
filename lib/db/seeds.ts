import "server-only";

import type { ProspectSource, ProspectStatus } from "@/lib/constants/prospects";
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
  const result = await supabase.from("prospects").select("source_seed_username, discovery_priority_label, discovery_priority_reason").eq("id", id).maybeSingle();
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
  return rows.filter((row) => row.inspected > 0 || row.review > 0 || row.approved > 0);
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
