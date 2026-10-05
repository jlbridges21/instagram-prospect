import type { SupabaseClient } from "@supabase/supabase-js";
import { shouldAutoPromote } from "@/lib/discovery/seeds";
import type { Database } from "@/lib/db/types";

type Client = SupabaseClient<Database>;

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
  if (prospect.error || !prospect.data) return { promoted: false as const };
  const row = prospect.data;
  if (!input.cached && row.source_seed_id && (input.status === "review" || input.qualified)) {
    await supabase.rpc("bump_discovery_seed", { p_id: row.source_seed_id, p_review: 1 }).then(() => undefined, () => undefined);
  }
  const approved = ["approved", "contacted", "replied", "follow_up", "demo_booked", "converted"].includes(row.status);
  const promote = shouldAutoPromote({
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
  if (!promote) return { promoted: false as const };
  const existing = await supabase.from("discovery_seeds").select("id").eq("instagram_username", row.instagram_username).maybeSingle();
  if (existing.error) return { promoted: false as const };
  if (existing.data) return { promoted: false as const, existing: true as const };
  const inserted = await supabase.from("discovery_seeds").insert({
    instagram_username: row.instagram_username,
    display_name: row.display_name,
    profile_url: row.profile_url,
    profile_picture_url: row.profile_picture_url,
    source_type: "auto_promoted",
    is_active: true,
    is_manual: false,
    auto_promoted_from_prospect_id: row.id,
    category: row.category,
    priority: "normal",
  });
  return { promoted: !inserted.error, existing: false as const };
}
