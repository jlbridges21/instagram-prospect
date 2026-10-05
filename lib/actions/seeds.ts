"use server";

import { revalidatePath } from "next/cache";
import { DEFAULT_DISCOVERY_OPTIMIZATION, DEFAULT_POSITIVE_KEYWORDS, clampTuning, type DiscoveryTuning } from "@/lib/discovery/defaults";
import { clampSeedNetworkSample, normalizeSeedUsername, uniqueSeedUsernames, type SeedPriority, type SeedSourceType } from "@/lib/discovery/seeds";
import { requireUser } from "@/lib/supabase/auth";

export type SeedActionResult = { ok: true; message?: string } | { ok: false; error: string };

function refresh() {
  revalidatePath("/settings");
  revalidatePath("/discovery");
  revalidatePath("/prospects");
}

export async function saveSeed(input: {
  id?: string;
  username: string;
  category?: string;
  notes?: string;
  priority?: SeedPriority;
  active?: boolean;
}): Promise<SeedActionResult> {
  const username = normalizeSeedUsername(input.username);
  if (!username) return { ok: false, error: "Enter a valid Instagram username or profile URL." };
  const { supabase } = await requireUser();
  const payload = {
    instagram_username: username,
    profile_url: `https://www.instagram.com/${username}/`,
    category: input.category?.trim() || null,
    notes: input.notes?.trim() || null,
    priority: input.priority ?? "normal",
    is_active: input.active !== false,
    updated_at: new Date().toISOString(),
  };
  const result = input.id
    ? await supabase.from("discovery_seeds").update(payload).eq("id", input.id)
    : await supabase.from("discovery_seeds").insert({
        ...payload,
        source_type: "manual" satisfies SeedSourceType,
        is_manual: true,
      });
  if (result.error) {
    if (/duplicate|unique/i.test(result.error.message)) return { ok: false, error: `@${username} is already a Discovery Seed.` };
    if (/discovery_seeds/i.test(result.error.message)) return { ok: false, error: "Run the Discovery Seeds migration before saving seeds." };
    return { ok: false, error: "Could not save that seed." };
  }
  refresh();
  return { ok: true, message: input.id ? "Seed updated." : `@${username} added.` };
}

export async function saveSeedsBulk(raw: string): Promise<SeedActionResult> {
  const names = uniqueSeedUsernames(raw);
  if (names.length === 0) return { ok: false, error: "Paste at least one username." };
  const { supabase } = await requireUser();
  const result = await supabase.from("discovery_seeds").upsert(
    names.map((username) => ({
      instagram_username: username,
      profile_url: `https://www.instagram.com/${username}/`,
      source_type: "manual" as const,
      is_manual: true,
      is_active: true,
      priority: "normal" as const,
      updated_at: new Date().toISOString(),
    })),
    { onConflict: "instagram_username", ignoreDuplicates: true },
  );
  if (result.error) return { ok: false, error: "Could not import those seeds. Apply the Discovery Seeds migration first." };
  refresh();
  return { ok: true, message: `Imported ${names.length} seed${names.length === 1 ? "" : "s"}. Existing seeds were kept.` };
}

export async function setSeedsActive(ids: string[], active: boolean): Promise<SeedActionResult> {
  if (ids.length === 0) return { ok: false, error: "Select at least one seed." };
  const { supabase } = await requireUser();
  const result = await supabase.from("discovery_seeds").update({ is_active: active, updated_at: new Date().toISOString() }).in("id", ids);
  if (result.error) return { ok: false, error: "Could not update those seeds." };
  refresh();
  return { ok: true, message: active ? "Seeds enabled." : "Seeds disabled." };
}

export async function deleteSeeds(ids: string[]): Promise<SeedActionResult> {
  if (ids.length === 0) return { ok: false, error: "Select at least one seed." };
  const { supabase } = await requireUser();
  const result = await supabase.from("discovery_seeds").delete().in("id", ids);
  if (result.error) return { ok: false, error: "Could not remove those seeds." };
  refresh();
  return { ok: true, message: "Seeds removed." };
}

export async function toggleProspectSeed(prospectId: string, username: string, enabled: boolean): Promise<SeedActionResult> {
  const name = normalizeSeedUsername(username);
  if (!name) return { ok: false, error: "That username is not valid." };
  const { supabase } = await requireUser();
  if (!enabled) {
    const result = await supabase.from("discovery_seeds").delete().eq("instagram_username", name);
    if (result.error) return { ok: false, error: "Could not remove that seed." };
    refresh();
    revalidatePath(`/prospects/${prospectId}`);
    return { ok: true, message: "Removed from Discovery Seeds." };
  }
  const result = await supabase.from("discovery_seeds").upsert({
    instagram_username: name,
    profile_url: `https://www.instagram.com/${name}/`,
    source_type: "manual",
    is_manual: true,
    is_active: true,
    auto_promoted_from_prospect_id: prospectId,
    priority: "normal",
    updated_at: new Date().toISOString(),
  }, { onConflict: "instagram_username" });
  if (result.error) return { ok: false, error: "Could not add that Discovery Seed." };
  refresh();
  revalidatePath(`/prospects/${prospectId}`);
  return { ok: true, message: "Discovery Seed saved." };
}

export async function saveDiscoveryOptimization(input: {
  autoPromote: boolean;
  autoPromoteMinScore: number;
  promoteStrong: boolean;
  promotePossible: boolean;
  promoteRequires: "review" | "approved";
  minSeedSample: number;
  favorYield: boolean;
  yieldStrength: "low" | "medium" | "high";
  homeFeedUsage: "low" | "medium" | "high";
  strategy: "conservative" | "balanced" | "exploratory";
  seedCooldownCycles: number;
  seedNetworkEnabled: boolean;
  seedNetworkSample: number;
  positiveKeywords: string[];
  negativeKeywords: string[];
  tuning: DiscoveryTuning;
}): Promise<SeedActionResult> {
  const { supabase } = await requireUser();
  const result = await supabase.from("settings").update({
    discovery_auto_promote: input.autoPromote,
    discovery_auto_promote_min_score: clamp(input.autoPromoteMinScore, 0, 100, DEFAULT_DISCOVERY_OPTIMIZATION.autoPromoteMinScore),
    discovery_promote_strong: input.promoteStrong,
    discovery_promote_possible: input.promotePossible,
    discovery_promote_requires: input.promoteRequires,
    discovery_min_seed_sample: clamp(input.minSeedSample, 1, 100, DEFAULT_DISCOVERY_OPTIMIZATION.minSeedSample),
    discovery_favor_yield: input.favorYield,
    discovery_yield_strength: input.yieldStrength,
    discovery_home_feed_usage: input.homeFeedUsage,
    discovery_strategy: input.strategy,
    discovery_seed_cooldown_cycles: clamp(input.seedCooldownCycles, 1, 10, DEFAULT_DISCOVERY_OPTIMIZATION.seedCooldownCycles),
    discovery_seed_network_enabled: input.seedNetworkEnabled,
    discovery_seed_network_sample: clampSeedNetworkSample(input.seedNetworkSample),
    discovery_positive_keywords: cleanKeywords(input.positiveKeywords),
    discovery_negative_keywords: cleanKeywords(input.negativeKeywords),
    discovery_tuning: clampTuning(input.tuning),
    updated_at: new Date().toISOString(),
  }).eq("id", 1);
  if (result.error) return { ok: false, error: "Could not save Discovery optimization. Apply the Discovery Seeds migration first." };
  refresh();
  return { ok: true, message: "Discovery optimization saved." };
}

export async function promoteExistingQualified(): Promise<SeedActionResult> {
  const { supabase } = await requireUser();
  const rows = await supabase
    .from("prospects")
    .select("id, instagram_username, display_name, profile_url, profile_picture_url, category, fit_label, qualified, status, already_following")
    .eq("qualified", true)
    .eq("fit_label", "strong_fit")
    .in("status", ["review", "approved"])
    .limit(200);
  if (rows.error) return { ok: false, error: "Could not read qualified prospects. Apply the Discovery Seeds migration first." };
  const eligible = (rows.data ?? []).filter((row) => row.already_following !== true && row.instagram_username);
  if (eligible.length === 0) return { ok: true, message: "No Strong Fit prospects were waiting to become seeds." };
  const result = await supabase.from("discovery_seeds").upsert(
    eligible.map((row) => ({
      instagram_username: row.instagram_username,
      display_name: row.display_name,
      profile_url: row.profile_url,
      profile_picture_url: row.profile_picture_url,
      category: row.category,
      source_type: "auto_promoted" as const,
      is_manual: false,
      is_active: true,
      auto_promoted_from_prospect_id: row.id,
      priority: "normal" as const,
      updated_at: new Date().toISOString(),
    })),
    { onConflict: "instagram_username", ignoreDuplicates: true },
  );
  if (result.error) return { ok: false, error: "Could not promote those prospects." };
  refresh();
  return { ok: true, message: `Checked ${eligible.length} Strong Fit prospects. Existing seeds were left unchanged.` };
}

export async function resetDiscoveryTuning(): Promise<SeedActionResult> {
  const current = await currentOptimization();
  return saveDiscoveryOptimization({ ...current, tuning: clampTuning(undefined) });
}

export async function resetDiscoveryKeywords(): Promise<SeedActionResult> {
  return saveDiscoveryOptimization({
    ...(await currentOptimization()),
    positiveKeywords: [...DEFAULT_POSITIVE_KEYWORDS],
    negativeKeywords: [],
  });
}

async function currentOptimization() {
  const { supabase } = await requireUser();
  const row = await supabase.from("settings").select("discovery_auto_promote, discovery_auto_promote_min_score, discovery_promote_strong, discovery_promote_possible, discovery_promote_requires, discovery_min_seed_sample, discovery_favor_yield, discovery_yield_strength, discovery_home_feed_usage, discovery_strategy, discovery_seed_cooldown_cycles, discovery_seed_network_enabled, discovery_seed_network_sample, discovery_positive_keywords, discovery_negative_keywords, discovery_tuning").eq("id", 1).maybeSingle();
  const data = row.data;
  return {
    autoPromote: data?.discovery_auto_promote ?? DEFAULT_DISCOVERY_OPTIMIZATION.autoPromote,
    autoPromoteMinScore: data?.discovery_auto_promote_min_score ?? DEFAULT_DISCOVERY_OPTIMIZATION.autoPromoteMinScore,
    promoteStrong: data?.discovery_promote_strong ?? DEFAULT_DISCOVERY_OPTIMIZATION.promoteStrong,
    promotePossible: data?.discovery_promote_possible ?? DEFAULT_DISCOVERY_OPTIMIZATION.promotePossible,
    promoteRequires: data?.discovery_promote_requires === "approved" ? "approved" as const : "review" as const,
    minSeedSample: data?.discovery_min_seed_sample ?? DEFAULT_DISCOVERY_OPTIMIZATION.minSeedSample,
    favorYield: data?.discovery_favor_yield ?? DEFAULT_DISCOVERY_OPTIMIZATION.favorYield,
    yieldStrength: data?.discovery_yield_strength ?? DEFAULT_DISCOVERY_OPTIMIZATION.yieldStrength,
    homeFeedUsage: data?.discovery_home_feed_usage ?? DEFAULT_DISCOVERY_OPTIMIZATION.homeFeedUsage,
    strategy: data?.discovery_strategy ?? DEFAULT_DISCOVERY_OPTIMIZATION.strategy,
    seedCooldownCycles: data?.discovery_seed_cooldown_cycles ?? DEFAULT_DISCOVERY_OPTIMIZATION.seedCooldownCycles,
    seedNetworkEnabled: data?.discovery_seed_network_enabled ?? DEFAULT_DISCOVERY_OPTIMIZATION.seedNetworkEnabled,
    seedNetworkSample: clampSeedNetworkSample(data?.discovery_seed_network_sample ?? DEFAULT_DISCOVERY_OPTIMIZATION.seedNetworkSample),
    positiveKeywords: data?.discovery_positive_keywords ?? [...DEFAULT_POSITIVE_KEYWORDS],
    negativeKeywords: data?.discovery_negative_keywords ?? [],
    tuning: clampTuning(data?.discovery_tuning),
  };
}

function cleanKeywords(values: string[]) {
  return [...new Set(values.map((value) => value.trim().toLowerCase()).filter((value) => value.length > 0 && value.length <= 40))].slice(0, 40);
}

function clamp(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}
