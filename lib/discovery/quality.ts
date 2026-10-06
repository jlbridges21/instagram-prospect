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
