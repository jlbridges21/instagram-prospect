export const QUALIFICATION_MODEL = "gpt-6-luna";

export const DEFAULT_STRONG_FIT_MINIMUM = 75;
export const DEFAULT_POSSIBLE_FIT_MINIMUM = 60;

export const AI_BATCH_LIMIT = 25;
export const AI_CONCURRENCY = 4;

export const LUNA_INPUT_USD_PER_TOKEN = 0.1 / 1_000_000;
export const LUNA_OUTPUT_USD_PER_TOKEN = 0.5 / 1_000_000;

export function estimateQualificationCost(inputTokens: number, outputTokens: number) {
  return inputTokens * LUNA_INPUT_USD_PER_TOKEN + outputTokens * LUNA_OUTPUT_USD_PER_TOKEN;
}
