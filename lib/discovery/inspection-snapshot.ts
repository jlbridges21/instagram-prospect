import { qualityBand } from "@/lib/discovery/candidate-priority";

export type PreOpenSnapshot = {
  instagram_username: string;
  card_text: string | null;
  source: string;
  source_seed_id: string | null;
  source_seed_username: string | null;
  seed_support_count: number;
  supporting_seed_usernames: string[];
  pre_score: number | null;
  niche_component: number | null;
  commercial_component: number | null;
  network_component: number | null;
  source_review_yield: number | null;
  source_approval_yield: number | null;
  source_prior_points: number | null;
  seed_review_yield: number | null;
  seed_approval_yield: number | null;
  seed_mature: boolean;
  strategy: string | null;
  priority_band: string | null;
  priority_label: string | null;
  selection_reasons: string | null;
  runner_up_username: string | null;
  runner_up_pre_score: number | null;
};

export function buildPreOpenSnapshot(input: {
  username: string;
  cardText?: string | null;
  source: string;
  sourceSeedId?: string | null;
  sourceSeedUsername?: string | null;
  seedSupport?: string[] | null;
  preScore?: number | null;
  nicheComponent?: number | null;
  commercialComponent?: number | null;
  networkComponent?: number | null;
  sourceReviewYield?: number | null;
  sourceApprovalYield?: number | null;
  sourcePriorPoints?: number | null;
  seedReviewYield?: number | null;
  seedApprovalYield?: number | null;
  seedMature?: boolean | null;
  strategy?: string | null;
  priorityLabel?: string | null;
  priorityReasons?: string[] | null;
  runnerUpUsername?: string | null;
  runnerUpPreScore?: number | null;
}): PreOpenSnapshot {
  const support = [...new Set((input.seedSupport ?? []).map((name) => name.trim().toLowerCase()).filter(Boolean))];
  const reasons = selectionReasons(input.priorityReasons);
  const score = typeof input.preScore === "number" ? input.preScore : null;
  return {
    instagram_username: input.username.trim().toLowerCase(),
    card_text: input.cardText?.trim() ? input.cardText.trim().slice(0, 1000) : null,
    source: input.source,
    source_seed_id: input.sourceSeedId ?? null,
    source_seed_username: input.sourceSeedUsername?.trim().toLowerCase() || null,
    seed_support_count: support.length,
    supporting_seed_usernames: support,
    pre_score: score,
    niche_component: input.nicheComponent ?? null,
    commercial_component: input.commercialComponent ?? null,
    network_component: input.networkComponent ?? null,
    source_review_yield: input.sourceReviewYield ?? null,
    source_approval_yield: input.sourceApprovalYield ?? null,
    source_prior_points: input.sourcePriorPoints ?? null,
    seed_review_yield: input.seedMature ? input.seedReviewYield ?? null : null,
    seed_approval_yield: input.seedMature ? input.seedApprovalYield ?? null : null,
    seed_mature: input.seedMature === true,
    strategy: input.strategy ?? null,
    priority_band: score == null ? null : qualityBand(score),
    priority_label: input.priorityLabel ?? null,
    selection_reasons: reasons.length > 0 ? reasons.join("\n").slice(0, 1000) : null,
    runner_up_username: input.runnerUpUsername?.trim().toLowerCase() || null,
    runner_up_pre_score: typeof input.runnerUpPreScore === "number" ? input.runnerUpPreScore : null,
  };
}

export function formatSelectionExplanation(input: {
  username: string;
  preScore: number | null;
  priorityBand: string | null;
  reasons: string[] | null | undefined;
  runnerUpUsername?: string | null;
  runnerUpPreScore?: number | null;
}) {
  const why = selectionReasons(input.reasons);
  const compared = input.runnerUpUsername
    ? `@${input.runnerUpUsername} — ${input.runnerUpPreScore ?? "unscored"}`
    : "No other candidate was waiting.";
  return [
    `@${input.username}`,
    `Pre-score: ${input.preScore ?? "unscored"}`,
    `Priority: ${input.priorityBand ?? "Unscored"}`,
    "",
    "Why selected:",
    ...(why.length > 0 ? why : ["Seed or source baseline only."]),
    "",
    "Compared with next candidate:",
    compared,
  ].join("\n");
}

export function selectionReasons(reasons: string[] | null | undefined) {
  return (reasons ?? []).filter((reason) => !/^(Niche relevance|Commercial intent|Network confidence|Historical quality):/.test(reason.trim()));
}
