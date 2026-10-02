import { QUALIFICATION_MODEL } from "@/lib/ai/config";
import { qualificationInput, qualificationInstructions } from "@/lib/ai/prompts";
import { QUALIFICATION_JSON_SCHEMA, qualificationSchema } from "@/lib/ai/schemas";
import type { QualificationInput, QualificationRules } from "@/lib/ai/types";
import type { TargetingSettings } from "@/lib/db/models";

const ENDPOINT = "https://api.openai.com/v1/responses";
const TIMEOUT_MS = 20_000;

type Usage = { inputTokens: number | null; outputTokens: number | null };

export async function requestQualification(
  input: QualificationInput,
  targeting: TargetingSettings,
) {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    return { ok: false as const, error: "OpenAI is not configured." };
  }

  let lastError = "Qualification failed.";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        body: JSON.stringify({
          model: QUALIFICATION_MODEL,
          reasoning: { effort: "low" },
          instructions: qualificationInstructions(targeting),
          input: qualificationInput(input),
          max_output_tokens: 2000,
          text: {
            format: {
              type: "json_schema",
              name: "prospect_qualification",
              strict: true,
              schema: QUALIFICATION_JSON_SCHEMA,
            },
          },
        }),
      });

      if (response.status === 429 || response.status >= 500) {
        lastError =
          response.status === 429
            ? "OpenAI rate limit reached. Wait a moment and try again."
            : "OpenAI is temporarily unavailable.";
        if (attempt === 0) {
          await delay(1000);
          continue;
        }
        return { ok: false as const, error: lastError };
      }

      if (!response.ok) {
        return { ok: false as const, error: "OpenAI could not qualify this profile." };
      }

      const payload = (await response.json()) as {
        output?: Array<{
          type?: string;
          content?: Array<{ type?: string; text?: string }>;
        }>;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const text = payload.output
        ?.flatMap((item) => item.content ?? [])
        .find((part) => part.type === "output_text" && part.text)?.text;

      if (!text) {
        return { ok: false as const, error: "The model returned an unexpected result." };
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return { ok: false as const, error: "The model returned an unexpected result." };
      }

      const analysis = qualificationSchema.safeParse(parsed);
      if (!analysis.success) {
        return { ok: false as const, error: "The model returned an unexpected result." };
      }

      return {
        ok: true as const,
        analysis: analysis.data,
        usage: usageFrom(payload.usage),
      };
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        lastError = "Qualification timed out. Try again.";
      } else {
        lastError = "Qualification could not reach OpenAI.";
      }
      if (attempt === 0) {
        await delay(1000);
        continue;
      }
      return { ok: false as const, error: lastError };
    }
  }

  return { ok: false as const, error: lastError };
}

function usageFrom(usage: { input_tokens?: number; output_tokens?: number } | undefined): Usage {
  return {
    inputTokens: numberOrNull(usage?.input_tokens),
    outputTokens: numberOrNull(usage?.output_tokens),
  };
}

function numberOrNull(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function rulesFromTargeting(
  targeting: TargetingSettings,
  thresholds: { strongFitMinimum: number; possibleFitMinimum: number },
): QualificationRules {
  return {
    minFollowers: targeting.minFollowers,
    maxFollowers: targeting.maxFollowers,
    englishOnly: targeting.englishOnly,
    preferUnitedStates: targeting.preferUnitedStates,
    allowUnknownLocation: targeting.allowUnknownLocation,
    excludeAlreadyFollowing: targeting.excludeAlreadyFollowing,
    excludeAlreadyContacted: targeting.excludeAlreadyContacted,
    excludeHobbyAccounts: targeting.excludeHobbyAccounts,
    excludeMemeAccounts: targeting.excludeMemeAccounts,
    excludeLargeAgencies: targeting.excludeLargeAgencies,
    excludeUnrelatedDrone: targeting.excludeUnrelatedDrone,
    strongFitMinimum: thresholds.strongFitMinimum,
    possibleFitMinimum: thresholds.possibleFitMinimum,
    categories: targeting.categories,
  };
}
