export const LEARNED_POSITIVE_STATUSES = ["review", "approved", "contacted", "replied", "follow_up", "demo_booked", "converted"] as const;
export const LEARNED_APPROVED_STATUSES = ["approved", "contacted", "replied", "follow_up", "demo_booked", "converted"] as const;
export const LEARNED_NEGATIVE_STATUSES = ["skipped", "disqualified"] as const;

const PREOPEN_FIELDS = ["username", "cardText", "source", "sourceSeed", "rankingReason"] as const;

export type LearnedExample = {
  username: string;
  text: string;
  positive: boolean;
  approved: boolean;
  oldScore: number | null;
};

export type LearnedToken = {
  token: string;
  positive: number;
  negative: number;
  sampleSize: number;
  positiveRate: number;
  smoothedRate: number;
  active: boolean;
};

export type LearnedModel = {
  tokens: LearnedToken[];
  vocabulary: string[];
  globalPositiveRate: number;
  positiveExamples: number;
  negativeExamples: number;
  minimum: number;
  strength: number;
  ignored: string[];
};

export function isLearnedPositive(status: string) {
  return (LEARNED_POSITIVE_STATUSES as readonly string[]).includes(status);
}

export function isLearnedApproved(status: string) {
  return (LEARNED_APPROVED_STATUSES as readonly string[]).includes(status);
}

export function isLearnedNegative(status: string) {
  return (LEARNED_NEGATIVE_STATUSES as readonly string[]).includes(status);
}

export function preOpenTrainingText(input: { username: string; cardText?: string | null; rankingReason?: string | null }) {
  const reasonTokens = tokensFromRankingReason(input.rankingReason);
  return [input.username, input.cardText ?? "", ...reasonTokens].filter(Boolean).join(" ");
}

export function trainingUsesPreOpenFields() {
  return PREOPEN_FIELDS;
}

export function tokensFromRankingReason(reason: string | null | undefined) {
  if (!reason) return [];
  const tokens: string[] = [];
  for (const part of reason.split("·")) {
    const match = part.trim().match(/^\+ ([a-z][a-z0-9 ]{2,40})$/i);
    if (!match) continue;
    const token = match[1].trim().toLowerCase();
    if (
      token === "seed network" ||
      token === "seed suggestion" ||
      token === "high-yield seed support" ||
      token.startsWith("commercial ") ||
      /^\d+ seed matches$/.test(token)
    ) continue;
    tokens.push(token);
  }
  return tokens;
}

export function splitTokens(text: string) {
  return [...new Set(text.toLowerCase().split(/[^a-z]+/).filter((token) => token.length >= 4 && token.length <= 24))];
}

export function exampleFromProspect(row: {
  instagram_username?: string | null;
  status?: string | null;
  discovery_priority_reason?: string | null;
  discovery_pre_score?: number | null;
  is_sample?: boolean | null;
}): LearnedExample | null {
  const username = row.instagram_username?.trim().toLowerCase() ?? "";
  const status = row.status ?? "";
  if (!username || row.is_sample === true) return null;
  if (!isLearnedPositive(status) && !isLearnedNegative(status)) return null;
  return {
    username,
    text: preOpenTrainingText({ username, rankingReason: row.discovery_priority_reason }),
    positive: isLearnedPositive(status),
    approved: isLearnedApproved(status),
    oldScore: typeof row.discovery_pre_score === "number" ? row.discovery_pre_score : null,
  };
}

export function coerceLearnedModel(value: unknown): LearnedModel | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const tokens = Array.isArray(source.tokens)
    ? source.tokens.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const token = item as Record<string, unknown>;
        if (typeof token.token !== "string" || !token.token.trim()) return [];
        const positive = numberOrZero(token.positive);
        const negative = numberOrZero(token.negative);
        const sampleSize = numberOrZero(token.sampleSize) || positive + negative;
        const positiveRate = typeof token.positiveRate === "number" ? token.positiveRate : sampleSize > 0 ? positive / sampleSize : 0;
        const smoothedRate = typeof token.smoothedRate === "number" ? token.smoothedRate : positiveRate;
        return [{
          token: token.token.trim().toLowerCase(),
          positive,
          negative,
          sampleSize,
          positiveRate,
          smoothedRate,
          active: token.active === true,
        } satisfies LearnedToken];
      })
    : [];
  const vocabulary = Array.isArray(source.vocabulary)
    ? source.vocabulary.filter((item): item is string => typeof item === "string")
    : tokens.filter((token) => token.token.length >= 5).map((token) => token.token);
  return {
    tokens,
    vocabulary,
    globalPositiveRate: typeof source.globalPositiveRate === "number" ? source.globalPositiveRate : 0,
    positiveExamples: numberOrZero(source.positiveExamples),
    negativeExamples: numberOrZero(source.negativeExamples),
    minimum: numberOrZero(source.minimum) || 8,
    strength: numberOrZero(source.strength) || 8,
    ignored: Array.isArray(source.ignored) ? source.ignored.filter((item): item is string => typeof item === "string") : [],
  };
}

function numberOrZero(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function holdoutSplit(username: string): "train" | "validation" {
  let hash = 0;
  for (const char of username) hash = (Math.imul(hash, 33) + char.charCodeAt(0)) >>> 0;
  return hash % 4 === 0 ? "validation" : "train";
}

export function learnQualityModel(input: {
  examples: LearnedExample[];
  minimum?: number;
  strength?: number;
  ignored?: string[];
}): LearnedModel {
  const minimum = input.minimum ?? 8;
  const strength = input.strength ?? 8;
  const ignored = [...new Set((input.ignored ?? []).map((token) => token.trim().toLowerCase()).filter(Boolean))];
  const labeled = dedupeExamples(input.examples);
  const positiveExamples = labeled.filter((example) => example.positive).length;
  const negativeExamples = labeled.length - positiveExamples;
  const globalPositiveRate = labeled.length > 0 ? positiveExamples / labeled.length : 0;
  const chunkSets = labeled.map((example) => splitTokens(example.text));
  const frequency = new Map<string, number>();
  for (const chunks of chunkSets) {
    for (const token of chunks) frequency.set(token, (frequency.get(token) ?? 0) + 1);
  }
  const vocabulary = [...frequency.entries()]
    .filter(([token, count]) => token.length >= 5 && count >= 3)
    .map(([token]) => token);
  const counts = new Map<string, { positive: number; negative: number }>();
  labeled.forEach((example, index) => {
    const tokens = new Set(chunkSets[index]);
    const haystack = example.text.toLowerCase();
    for (const token of vocabulary) {
      if (haystack.includes(token)) tokens.add(token);
    }
    for (const token of tokens) {
      const current = counts.get(token) ?? { positive: 0, negative: 0 };
      if (example.positive) current.positive += 1;
      else current.negative += 1;
      counts.set(token, current);
    }
  });
  const tokens = [...counts.entries()]
    .map(([token, count]) => tokenStat(token, count.positive, count.negative, globalPositiveRate, strength, minimum))
    .sort((left, right) => right.sampleSize - left.sampleSize || right.positiveRate - left.positiveRate);
  return { tokens, vocabulary, globalPositiveRate, positiveExamples, negativeExamples, minimum, strength, ignored };
}

export function historicalAdjustment(input: {
  text: string;
  model: LearnedModel | null | undefined;
  weight: number;
}) {
  const weight = Math.max(0, input.weight);
  const neutral = { points: 0, component: 10, reasons: [] as string[] };
  if (!input.model || weight === 0 || input.model.tokens.length === 0) return neutral;
  const ignored = new Set(input.model.ignored);
  const observed = matchedTokens(input.text, input.model);
  const active = observed
    .map((token) => input.model?.tokens.find((item) => item.token === token && item.active && !ignored.has(item.token)))
    .filter((item): item is LearnedToken => Boolean(item));
  if (active.length === 0) return neutral;
  let weightedLift = 0;
  let sampleWeight = 0;
  const details = active.map((token) => {
    const lift = (token.smoothedRate - input.model!.globalPositiveRate) / Math.max(input.model!.globalPositiveRate, 0.05);
    const influence = Math.min(token.sampleSize, 40);
    weightedLift += lift * influence;
    sampleWeight += influence;
    return { token, lift };
  });
  const meanLift = sampleWeight > 0 ? weightedLift / sampleWeight : 0;
  const points = clamp(Math.round(meanLift * (weight / 2)), -weight, weight);
  const component = clamp(10 + Math.round((points / weight) * 10), 0, 20);
  const reasons = details
    .sort((left, right) => Math.abs(right.lift) - Math.abs(left.lift))
    .slice(0, 3)
    .map((item) => {
      const rate = Math.round(item.token.positiveRate * 100);
      const tone = item.lift >= 0 ? "historically strong" : "historically weak";
      const sign = item.lift >= 0 ? "+" : "-";
      return `${sign} "${item.token.token}" ${tone} (${rate}% positive, ${item.token.sampleSize} examples)`;
    });
  return { points, component, reasons };
}

export function matchedTokens(text: string, model: LearnedModel) {
  const tokens = new Set(splitTokens(text));
  const haystack = text.toLowerCase();
  for (const token of model.vocabulary) {
    if (token.length >= 5 && haystack.includes(token)) tokens.add(token);
  }
  for (const token of model.tokens) {
    if (token.active && token.token.length >= 5 && haystack.includes(token.token)) tokens.add(token.token);
  }
  return [...tokens];
}

export function rankYield(rows: Array<{ score: number; positive: boolean; approved: boolean }>, fraction: number) {
  const ordered = [...rows].sort((left, right) => right.score - left.score);
  const count = Math.max(1, Math.round(ordered.length * fraction));
  const slice = fraction >= 1 ? ordered : ordered.slice(0, count);
  const bottom = ordered.slice(Math.floor(ordered.length / 2));
  const chosen = fraction === 0.5 && rows.length > 0 ? { top: slice, bottom } : { top: slice, bottom };
  return {
    inspected: chosen.top.length,
    reviewYield: rate(chosen.top, (row) => row.positive),
    approvalYield: rate(chosen.top, (row) => row.approved),
    bottomReviewYield: rate(chosen.bottom, (row) => row.positive),
    bottomApprovalYield: rate(chosen.bottom, (row) => row.approved),
  };
}

export function precisionAt(rows: Array<{ score: number; positive: boolean }>, count: number) {
  const top = [...rows].sort((left, right) => right.score - left.score).slice(0, count);
  if (top.length === 0) return 0;
  return top.filter((row) => row.positive).length / top.length;
}

function tokenStat(token: string, positive: number, negative: number, globalRate: number, strength: number, minimum: number): LearnedToken {
  const sampleSize = positive + negative;
  const positiveRate = sampleSize > 0 ? positive / sampleSize : 0;
  const smoothedRate = (positive + globalRate * strength) / (sampleSize + strength);
  return {
    token,
    positive,
    negative,
    sampleSize,
    positiveRate,
    smoothedRate,
    active: sampleSize >= minimum,
  };
}

function dedupeExamples(examples: LearnedExample[]) {
  const seen = new Map<string, LearnedExample>();
  for (const example of examples) {
    const username = example.username.trim().toLowerCase();
    if (!username || seen.has(username)) continue;
    seen.set(username, example);
  }
  return [...seen.values()];
}

function rate(rows: Array<{ positive: boolean; approved: boolean }>, pick: (row: { positive: boolean; approved: boolean }) => boolean) {
  if (rows.length === 0) return 0;
  return rows.filter(pick).length / rows.length;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
