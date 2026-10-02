import { createHash } from "node:crypto";
import type { AiCategory } from "@/lib/ai/categories";
import { isAiCategory } from "@/lib/ai/categories";
import { requestQualification } from "@/lib/ai/openai";
import type { ExclusionReason, QualificationAnalysis } from "@/lib/ai/schemas";
import type { QualificationDecision, QualificationInput, QualificationRules } from "@/lib/ai/types";
import type { FitLabel } from "@/lib/constants/prospects";
import type { TargetingSettings } from "@/lib/db/models";

const emptySignals = {
  professional_media_business: false,
  drone_services: false,
  real_estate_media: false,
  videography_services: false,
  commercial_media: false,
  solo_or_small_team: false,
};

export function qualificationFingerprint(input: QualificationInput, rules: QualificationRules) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        username: input.instagramUsername,
        displayName: input.displayName,
        bio: input.bio,
        followerCount: input.followerCount,
        followingCount: input.followingCount,
        locationText: input.locationText,
        category: input.category,
        alreadyFollowing: input.alreadyFollowing,
        alreadyContacted: input.alreadyContacted,
        postUrl: input.instagramPostUrl,
        notes: clip(input.notes, 500),
        sourceContext: clip(input.sourceContext, 500),
        rules,
      }),
    )
    .digest("hex");
}

export async function evaluateProspect(
  input: QualificationInput,
  rules: QualificationRules,
  targeting: TargetingSettings,
  options?: { allowModel?: boolean },
): Promise<{ ok: true; decision: QualificationDecision } | { ok: false; error: string }> {
  const hard = hardExclusion(input, rules);
  if (hard) {
    return { ok: true, decision: decisionFrom(hard, input, rules, false, null, null) };
  }

  if (options?.allowModel === false) {
    return { ok: false, error: "AI qualification is turned off in Settings." };
  }

  const model = await requestQualification(compactInput(input), targeting);
  if (!model.ok) return model;

  const normalized = normalizeModelResult(model.analysis, input, rules);
  return {
    ok: true,
    decision: decisionFrom(
      normalized,
      input,
      rules,
      true,
      model.usage.inputTokens,
      model.usage.outputTokens,
    ),
  };
}

function compactInput(input: QualificationInput): QualificationInput {
  return {
    ...input,
    bio: clip(input.bio, 1000),
    notes: clip(input.notes, 500),
    sourceContext: clip(input.sourceContext, 500),
  };
}

function hardExclusion(input: QualificationInput, rules: QualificationRules): QualificationAnalysis | null {
  if (rules.excludeAlreadyFollowing && input.alreadyFollowing) {
    return skipped(input, "already_following", "Already following this account.");
  }
  if (rules.excludeAlreadyContacted && input.alreadyContacted) {
    return skipped(input, "already_contacted", "Already contacted this account.");
  }
  if (input.followerCount !== null && input.followerCount < rules.minFollowers) {
    return skipped(
      input,
      "follower_range",
      `Follower count is below the ${rules.minFollowers} minimum.`,
    );
  }
  if (input.followerCount !== null && input.followerCount > rules.maxFollowers) {
    return skipped(
      input,
      "follower_range",
      `Follower count is above the ${rules.maxFollowers} maximum.`,
    );
  }
  return null;
}

function skipped(
  input: QualificationInput,
  reason: ExclusionReason,
  text: string,
): QualificationAnalysis {
  return {
    qualified: false,
    fit_score: 0,
    fit_label: "skip",
    category: isAiCategory(input.category ?? "") ? input.category as AiCategory : null,
    first_name: null,
    first_name_confidence: 0,
    english_likely: null,
    english_confidence: 0,
    us_based_likely: null,
    location_confidence: 0,
    exclusion_reason: reason,
    qualification_reason: text,
    signals: emptySignals,
  };
}

function normalizeModelResult(
  analysis: QualificationAnalysis,
  input: QualificationInput,
  rules: QualificationRules,
): QualificationAnalysis {
  let score = analysis.fit_score;
  let exclusion = analysis.exclusion_reason;
  let reason = analysis.qualification_reason;

  if (input.followerCount === null && exclusion === "follower_range") {
    exclusion = null;
  }

  if (analysis.us_based_likely === null && rules.allowUnknownLocation) {
    // Unknown location stays eligible. Do not convert null to a rejection.
  }

  if (
    rules.preferUnitedStates &&
    analysis.us_based_likely === false &&
    analysis.location_confidence >= 0.75
  ) {
    score = Math.max(0, score - 10);
    reason = `${reason} Location appears to be outside the United States, which lowers the fit.`;
  }

  if (
    rules.englishOnly &&
    analysis.english_likely === false &&
    analysis.english_confidence >= 0.75
  ) {
    exclusion = "non_english";
    reason = "The profile appears to be non-English.";
  }

  if (exclusion && !exclusionApplies(exclusion, rules, input)) {
    exclusion = null;
  }

  if (exclusion) score = Math.min(score, rules.possibleFitMinimum - 1);

  return {
    ...analysis,
    fit_score: clamp(score, 0, 100),
    exclusion_reason: exclusion,
    qualification_reason: reason.slice(0, 500),
    first_name: acceptedFirstName(analysis, input),
    first_name_confidence: acceptedFirstName(analysis, input) ? analysis.first_name_confidence : 0,
  };
}

function exclusionApplies(
  reason: ExclusionReason,
  rules: QualificationRules,
  input: QualificationInput,
) {
  if (reason === "hobby") return rules.excludeHobbyAccounts;
  if (reason === "meme") return rules.excludeMemeAccounts;
  if (reason === "unrelated_drone") return rules.excludeUnrelatedDrone;
  if (reason === "large_company") return rules.excludeLargeAgencies;
  if (reason === "non_english") return rules.englishOnly;
  if (reason === "already_following") return rules.excludeAlreadyFollowing && input.alreadyFollowing;
  if (reason === "already_contacted") return rules.excludeAlreadyContacted && input.alreadyContacted;
  if (reason === "follower_range") {
    return (
      input.followerCount !== null &&
      (input.followerCount < rules.minFollowers || input.followerCount > rules.maxFollowers)
    );
  }
  return reason === "wrong_niche";
}

function acceptedFirstName(analysis: QualificationAnalysis, input: QualificationInput) {
  const name = analysis.first_name?.trim() ?? "";
  if (!name || analysis.first_name_confidence < 0.75) return null;
  if (!/^[A-Za-z][A-Za-z'’-]*$/.test(name)) return null;
  const corpus = [input.displayName, input.bio, input.firstName].filter(Boolean).join(" ");
  const pattern = new RegExp(`\\b${escapeRegExp(name)}\\b`, "i");
  return pattern.test(corpus) ? name : null;
}

function decisionFrom(
  analysis: QualificationAnalysis,
  input: QualificationInput,
  rules: QualificationRules,
  calledModel: boolean,
  inputTokens: number | null,
  outputTokens: number | null,
): QualificationDecision {
  const fitLabel = labelForScore(analysis.fit_score, analysis.exclusion_reason, rules);
  const qualified = fitLabel !== "skip";
  const detected = analysis.first_name;
  const keepExisting =
    Boolean(input.firstName?.trim()) &&
    !(detected && analysis.first_name_confidence >= 0.9);
  const firstName = keepExisting ? input.firstName : detected;

  let language = input.language;
  if (!language && analysis.english_likely === true && analysis.english_confidence >= 0.75) {
    language = "en";
  }
  if (!input.language && analysis.english_likely === false && analysis.english_confidence >= 0.75) {
    language = "non-english";
  }

  return {
    analysis: { ...analysis, fit_label: fitLabel, qualified },
    fitScore: analysis.fit_score,
    fitLabel,
    category: analysis.category,
    qualified,
    status: qualified ? "review" : "disqualified",
    firstName,
    language,
    calledModel,
    inputTokens,
    outputTokens,
  };
}

function labelForScore(
  score: number,
  exclusion: ExclusionReason | null,
  rules: QualificationRules,
): FitLabel {
  if (exclusion) return "skip";
  if (score >= rules.strongFitMinimum) return "strong_fit";
  if (score >= rules.possibleFitMinimum) return "possible_fit";
  return "skip";
}

function clip(value: string | null | undefined, max: number) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
