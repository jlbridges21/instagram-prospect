export type SeedPromotionMode = "automatic" | "approved";

export type SeedPromotionOutcome = "created" | "existing" | "disabled" | "removed" | "ineligible" | "skipped";

export type ExistingSeedSnapshot = {
  isActive: boolean;
  displayName: string | null;
  profileUrl: string | null;
  profilePictureUrl: string | null;
  prospectId: string | null;
  category: string | null;
};

export type ProspectSeedSource = {
  id: string;
  displayName: string | null;
  profileUrl: string | null;
  profilePictureUrl: string | null;
  category: string | null;
};

export type SeedFieldPatch = {
  display_name?: string;
  profile_url?: string;
  profile_picture_url?: string;
  auto_promoted_from_prospect_id?: string;
  category?: string;
  updated_at?: string;
};

export type NewSeedRow = {
  instagram_username: string;
  display_name: string | null;
  profile_url: string;
  profile_picture_url: string | null;
  source_type: "auto_promoted";
  is_active: true;
  is_manual: false;
  auto_promoted_from_prospect_id: string;
  category: string | null;
  priority: "normal";
};

export function missingSeedFields(existing: ExistingSeedSnapshot, prospect: ProspectSeedSource): SeedFieldPatch {
  const patch: SeedFieldPatch = {};
  if (!existing.displayName && prospect.displayName) patch.display_name = prospect.displayName;
  if (!existing.profileUrl && prospect.profileUrl) patch.profile_url = prospect.profileUrl;
  if (!existing.profilePictureUrl && prospect.profilePictureUrl) patch.profile_picture_url = prospect.profilePictureUrl;
  if (!existing.prospectId) patch.auto_promoted_from_prospect_id = prospect.id;
  if (!existing.category && prospect.category) patch.category = prospect.category;
  return patch;
}

export function seedPromotionDecision(input: {
  mode: SeedPromotionMode;
  automatic: boolean;
  username: string;
  alreadyFollowing: boolean;
  removed: boolean;
  existing: ExistingSeedSnapshot | null;
  prospect: ProspectSeedSource;
}):
  | { outcome: "skipped" | "ineligible" | "removed" }
  | { outcome: "disabled" | "existing"; patch: SeedFieldPatch }
  | { outcome: "created"; row: NewSeedRow } {
  if (input.mode === "automatic" && !input.automatic) return { outcome: "skipped" };
  if (!input.username || input.alreadyFollowing) return { outcome: "ineligible" };
  if (input.existing && !input.existing.isActive) {
    return { outcome: "disabled", patch: missingSeedFields(input.existing, input.prospect) };
  }
  if (input.existing) {
    return { outcome: "existing", patch: missingSeedFields(input.existing, input.prospect) };
  }
  if (input.removed) return { outcome: "removed" };
  return {
    outcome: "created",
    row: {
      instagram_username: input.username,
      display_name: input.prospect.displayName,
      profile_url: input.prospect.profileUrl || `https://www.instagram.com/${input.username}/`,
      profile_picture_url: input.prospect.profilePictureUrl,
      source_type: "auto_promoted",
      is_active: true,
      is_manual: false,
      auto_promoted_from_prospect_id: input.prospect.id,
      category: input.prospect.category,
      priority: "normal",
    },
  };
}

export function approvalSeedMessage(outcomes: SeedPromotionOutcome[]) {
  if (outcomes.length === 1) {
    if (outcomes[0] === "created") return "Approved · Added as Discovery Seed";
    if (outcomes[0] === "existing") return "Approved · Already a Discovery Seed";
    if (outcomes[0] === "disabled") return "Approved · Discovery Seed stays disabled";
    if (outcomes[0] === "removed") return "Approved · Discovery Seed stays removed";
    return null;
  }
  const created = outcomes.filter((outcome) => outcome === "created").length;
  const already = outcomes.filter((outcome) => outcome === "existing" || outcome === "disabled" || outcome === "removed").length;
  const parts: string[] = [];
  if (created > 0) parts.push(`Added ${created} as Discovery Seed${created === 1 ? "" : "s"}`);
  if (already > 0) parts.push(`${already} already a Discovery Seed`);
  return parts.length > 0 ? parts.join(". ") + "." : null;
}
