export const PRE_SCORE_BANDS = [
  { label: "0–29", min: 0, max: 29 },
  { label: "30–49", min: 30, max: 49 },
  { label: "50–69", min: 50, max: 69 },
  { label: "70–84", min: 70, max: 84 },
  { label: "85–100", min: 85, max: 100 },
] as const;

const REVIEW_STATUSES = new Set(["review", "approved", "contacted", "replied", "follow_up", "demo_booked", "converted"]);

export function isReviewStatus(status: string | null | undefined) {
  return REVIEW_STATUSES.has(status ?? "");
}

export function summarizePreScoreBands(rows: Array<{ score: number | null; review: boolean }>) {
  return PRE_SCORE_BANDS.map((band) => {
    const matched = rows.filter((row) => row.score != null && row.score >= band.min && row.score <= band.max);
    const review = matched.filter((row) => row.review).length;
    return {
      label: band.label,
      inspected: matched.length,
      review,
      reviewYield: matched.length > 0 ? review / matched.length : 0,
    };
  });
}

export function qualityYield(input: { inspected: number; review: number; approved: number }) {
  const inspected = Math.max(0, input.inspected);
  return {
    inspected,
    review: Math.max(0, input.review),
    approved: Math.max(0, input.approved),
    reviewYield: inspected > 0 ? input.review / inspected : 0,
    approvalYield: inspected > 0 ? input.approved / inspected : 0,
  };
}

export function optimizationComparison(input: {
  before: { inspected: number; review: number; approved: number };
  after: { inspected: number; review: number; approved: number };
}) {
  return {
    before: qualityYield(input.before),
    after: qualityYield(input.after),
    ready: input.after.inspected >= 100,
  };
}

export function summarizeScoreMix(scores: number[]) {
  const usable = scores.filter((score) => Number.isFinite(score));
  const fallback = usable.filter((score) => score >= 18 && score <= 24).length;
  const stronger = usable.filter((score) => score >= 25).length;
  const sorted = [...usable].sort((left, right) => left - right);
  const average = usable.length > 0 ? usable.reduce((sum, score) => sum + score, 0) / usable.length : null;
  const median = usable.length > 0 ? sorted[Math.floor((sorted.length - 1) / 2)] ?? null : null;
  return {
    inspected: usable.length,
    fallback,
    stronger,
    fallbackShare: usable.length > 0 ? fallback / usable.length : 0,
    average,
    median,
  };
}

export function summarizeFunnel(input: { collected: number; deferred: number; opened: number; review: number }) {
  return {
    collected: input.collected,
    deferred: input.deferred,
    opened: input.opened,
    review: input.review,
    reviewPerOpened: input.opened > 0 ? input.review / input.opened : 0,
    reviewPerCollected: input.collected > 0 ? input.review / input.collected : 0,
  };
}

export function summarizeSourceYield(
  rows: Array<{ source: string; review: boolean }>,
  groups: ReadonlyArray<{ source: string; label: string }>,
) {
  return groups.map((group) => {
    const matched = rows.filter((row) => row.source === group.source);
    const review = matched.filter((row) => row.review).length;
    return {
      source: group.label,
      inspected: matched.length,
      review,
      reviewYield: matched.length > 0 ? review / matched.length : 0,
    };
  });
}
