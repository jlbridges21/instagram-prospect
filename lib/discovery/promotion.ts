import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingRelation } from "@/lib/db/errors";
import type { Database } from "@/lib/db/types";
import {
  seedPromotionDecision,
  type SeedPromotionMode,
  type SeedPromotionOutcome,
} from "@/lib/discovery/promotion-rules";
import { normalizeSeedUsername, shouldAutoPromote } from "@/lib/discovery/seeds";

type Client = SupabaseClient<Database>;

export type ProspectSeedInput = {
  id: string;
  instagram_username: string;
  display_name: string | null;
  profile_url: string | null;
  profile_picture_url: string | null;
  category: string | null;
  already_following: boolean | null;
  source_seed_id?: string | null;
};

export async function promoteProspectToSeed(
  supabase: Client,
  prospect: ProspectSeedInput,
  mode: SeedPromotionMode,
  automatic = false,
): Promise<{ outcome: SeedPromotionOutcome }> {
  const username = normalizeSeedUsername(prospect.instagram_username);
  const [removed, existing] = await Promise.all([
    removalRecorded(supabase, username),
    existingSeed(supabase, username),
  ]);
  const decision = seedPromotionDecision({
    mode,
    automatic,
    username,
    alreadyFollowing: prospect.already_following === true,
    removed,
    existing,
    prospect: {
      id: prospect.id,
      displayName: prospect.display_name,
      profileUrl: prospect.profile_url,
      profilePictureUrl: prospect.profile_picture_url,
      category: prospect.category,
    },
  });
  if (decision.outcome === "created") {
    const inserted = await supabase.from("discovery_seeds").insert(decision.row);
    if (inserted.error?.code === "23505") return { outcome: "existing" };
    if (inserted.error) return { outcome: "skipped" };
    return { outcome: "created" };
  }
  if ((decision.outcome === "existing" || decision.outcome === "disabled") && Object.keys(decision.patch).length > 0) {
    await supabase
      .from("discovery_seeds")
      .update({ ...decision.patch, updated_at: new Date().toISOString() })
      .eq("instagram_username", username);
  }
  return { outcome: decision.outcome };
}

export async function recordQualificationSeedEffects(
  supabase: Client,
  prospectId: string,
  input: {
    cached: boolean;
    qualified: boolean;
    fitScore: number | null;
    fitLabel: string | null;
    status: string;
    settings: {
      autoPromote: boolean;
      autoPromoteMinScore: number;
      promoteStrong: boolean;
      promotePossible: boolean;
      promoteRequires: "review" | "approved";
    };
  },
) {
  const prospect = await supabase
    .from("prospects")
    .select("id, instagram_username, display_name, profile_url, profile_picture_url, category, status, already_following, source_seed_id")
    .eq("id", prospectId)
    .maybeSingle();
  if (prospect.error || !prospect.data) return { promoted: false as const, seedCredit: null };
  const row = prospect.data;
  const seedCredit = row.source_seed_id ? await readSeedCredit(supabase, row.id, row.instagram_username, row.source_seed_id) : null;
  const approved = ["approved", "contacted", "replied", "follow_up", "demo_booked", "converted"].includes(row.status);
  const automatic = shouldAutoPromote({
    enabled: input.settings.autoPromote,
    qualified: input.qualified,
    fitScore: input.fitScore,
    fitLabel: input.fitLabel,
    minScore: input.settings.autoPromoteMinScore,
    promoteStrong: input.settings.promoteStrong,
    promotePossible: input.settings.promotePossible,
    requiresApproved: input.settings.promoteRequires === "approved",
    approved,
    disqualified: row.status === "disqualified" || row.status === "skipped" || input.status === "disqualified",
    alreadyFollowing: row.already_following === true,
  });
  const promoted = await promoteProspectToSeed(supabase, row, "automatic", automatic);
  return { promoted: promoted.outcome === "created", existing: promoted.outcome === "existing", seedCredit };
}

export async function readSeedCredit(supabase: Client, prospectId: string, prospectUsername: string, seedId: string) {
  const synced = await supabase.rpc("sync_discovery_seed_prospect", { p_prospect_id: prospectId });
  const fromSync = Array.isArray(synced.data) ? synced.data[0] : null;
  if (!synced.error && fromSync) {
    return {
      username: await seedUsername(supabase, seedId),
      prospectUsername,
      inspected: fromSync.profiles_inspected,
      review: fromSync.profiles_reaching_review,
      syncError: null as string | null,
    };
  }
  const seed = await supabase
    .from("discovery_seeds")
    .select("instagram_username, profiles_inspected, profiles_reaching_review")
    .eq("id", seedId)
    .maybeSingle();
  if (seed.error || !seed.data) return null;
  return {
    username: seed.data.instagram_username,
    prospectUsername,
    inspected: seed.data.profiles_inspected,
    review: seed.data.profiles_reaching_review,
    syncError: synced.error?.message ?? null,
  };
}

async function seedUsername(supabase: Client, seedId: string) {
  const seed = await supabase.from("discovery_seeds").select("instagram_username").eq("id", seedId).maybeSingle();
  return seed.data?.instagram_username ?? "";
}

async function removalRecorded(supabase: Client, username: string) {
  if (!username) return false;
  const result = await supabase.from("discovery_seed_removals").select("instagram_username").eq("instagram_username", username).maybeSingle();
  if (result.error) return false;
  return Boolean(result.data);
}

async function existingSeed(supabase: Client, username: string) {
  if (!username) return null;
  const result = await supabase
    .from("discovery_seeds")
    .select("is_active, display_name, profile_url, profile_picture_url, auto_promoted_from_prospect_id, category")
    .eq("instagram_username", username)
    .maybeSingle();
  if (result.error || !result.data) return null;
  return {
    isActive: result.data.is_active,
    displayName: result.data.display_name,
    profileUrl: result.data.profile_url,
    profilePictureUrl: result.data.profile_picture_url,
    prospectId: result.data.auto_promoted_from_prospect_id,
    category: result.data.category,
  };
}

export async function rememberSeedRemoval(supabase: Client, usernames: string[]) {
  const names = [...new Set(usernames.map((username) => normalizeSeedUsername(username)).filter(Boolean))];
  if (names.length === 0) return { ok: true as const };
  const result = await supabase.from("discovery_seed_removals").upsert(names.map((instagram_username) => ({ instagram_username })));
  if (result.error && isMissingRelation(result.error)) return { ok: false as const, missing: true as const };
  if (result.error) return { ok: false as const, missing: false as const };
  return { ok: true as const };
}

export async function clearSeedRemoval(supabase: Client, usernames: string[]) {
  const names = [...new Set(usernames.map((username) => normalizeSeedUsername(username)).filter(Boolean))];
  if (names.length === 0) return;
  await supabase.from("discovery_seed_removals").delete().in("instagram_username", names).then(() => undefined, () => undefined);
}
