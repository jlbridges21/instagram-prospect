import "server-only";

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

export async function discoverySourceStats(days: number | null) {
  const supabase = await createClient();
  let query = supabase.from("prospects").select("source, status, source_seed_id, source_seed_username").limit(2000);
  if (days) query = query.gte("discovered_at", new Date(Date.now() - days * 86400000).toISOString());
  const result = await query;
  if (result.error) return [];
  const grouped = new Map<string, { inspected: number; review: number; approved: number }>();
  for (const row of result.data ?? []) {
    const key = row.source === "seed_suggestion" ? "Seed suggestions" : row.source === "suggested_accounts" ? "Suggested Accounts" : row.source === "home_feed" ? "Home Feed" : "Other";
    const bucket = grouped.get(key) ?? { inspected: 0, review: 0, approved: 0 };
    bucket.inspected += 1;
    if (isReview(row.status)) bucket.review += 1;
    if (isApproved(row.status)) bucket.approved += 1;
    grouped.set(key, bucket);
  }
  return [...grouped.entries()].map(([source, counts]) => ({
    source,
    ...counts,
    reviewYield: reviewYield(counts.inspected, counts.review),
    approvalYield: reviewYield(counts.inspected, counts.approved),
  }));
}

function isReview(status: string) {
  return ["review", "approved", "contacted", "replied", "follow_up", "demo_booked", "converted"].includes(status);
}

function isApproved(status: string) {
  return ["approved", "contacted", "replied", "follow_up", "demo_booked", "converted"].includes(status);
}
