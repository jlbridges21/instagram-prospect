"use server";

import { revalidatePath } from "next/cache";
import { estimateQualificationCost, QUALIFICATION_MODEL } from "@/lib/ai/config";
import { evaluateProspect } from "@/lib/ai/evaluate";
import { applyStoredDecision, qualifyStoredProspect } from "@/lib/ai/persist";
import { rulesFromTargeting } from "@/lib/ai/openai";
import { qualificationSchema } from "@/lib/ai/schemas";
import type { QualificationDecision, QualificationInput } from "@/lib/ai/types";
import { createManualProspect } from "@/lib/prospects/service";
import { recordQualificationSeedEffects } from "@/lib/discovery/promotion";
import { fallbackSettings, getSettings } from "@/lib/db/settings";
import { fallbackTargeting, getTargetingSettings } from "@/lib/db/settings";
import { requireUser } from "@/lib/supabase/auth";
import { isUuid } from "@/lib/utils/format";

export type QualifyActionResult =
  | {
      ok: true;
      cached: boolean;
      fitScore: number;
      fitLabel: string;
      qualified: boolean;
      reason: string;
      calledModel: boolean;
    }
  | { ok: false; error: string };

function refresh(id?: string) {
  revalidatePath("/");
  revalidatePath("/prospects");
  revalidatePath("/review");
  revalidatePath("/analytics");
  revalidatePath("/settings");
  if (id) revalidatePath(`/prospects/${id}`);
}

async function context() {
  const { supabase, user } = await requireUser();
  const [settingsResult, targetingResult] = await Promise.all([getSettings(), getTargetingSettings()]);
  const settings = settingsResult.ok ? settingsResult.data : fallbackSettings();
  const targeting = targetingResult.ok ? targetingResult.data : fallbackTargeting();
  return { supabase, user, settings, targeting };
}

export async function qualifyProspectAction(
  id: string,
  force = false,
): Promise<QualifyActionResult> {
  if (!isUuid(id)) return { ok: false, error: "That prospect could not be found." };
  const { supabase, user, settings, targeting } = await context();
  const result = await qualifyStoredProspect(supabase, id, settings, targeting, {
    force,
    actor: user.email ?? "authenticated user",
  });
  if (!result.ok) return result;
  await recordQualificationSeedEffects(supabase, id, {
    cached: result.result.cached,
    qualified: result.result.decision.qualified,
    fitScore: result.result.decision.fitScore,
    fitLabel: result.result.decision.fitLabel,
    status: result.result.decision.status,
    settings: settings.optimization,
  }).catch(() => undefined);
  refresh(id);
  return summary(result.result.decision, result.result.cached);
}

export async function testQualification(input: QualificationInput): Promise<
  | { ok: true; decision: QualificationDecision; cached: false }
  | { ok: false; error: string }
> {
  const { supabase, settings, targeting } = await context();
  if (!settings.aiEnabled) return { ok: false, error: "AI qualification is turned off in Settings." };
  const rules = rulesFromTargeting(targeting, {
    strongFitMinimum: settings.strongFitMinimum,
    possibleFitMinimum: settings.possibleFitMinimum,
  });
  const result = await evaluateProspect(input, rules, targeting);
  if (!result.ok) return result;
  if (result.decision.calledModel) {
    await supabase.from("ai_usage").insert({
      prospect_id: null,
      model: QUALIFICATION_MODEL,
      operation: "test_qualification",
      input_tokens: result.decision.inputTokens,
      output_tokens: result.decision.outputTokens,
      estimated_cost_usd:
        result.decision.inputTokens !== null && result.decision.outputTokens !== null
          ? estimateQualificationCost(result.decision.inputTokens, result.decision.outputTokens)
          : null,
    });
  }
  return { ok: true, decision: result.decision, cached: false };
}

export async function saveTestedProspect(
  input: QualificationInput,
  decision: QualificationDecision,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { supabase, user, settings, targeting } = await context();
  const created = await createManualProspect(
    supabase,
    {
      instagramUsername: input.instagramUsername,
      displayName: input.displayName ?? "",
      firstName: decision.firstName ?? "",
      profileUrl: "",
      profilePictureUrl: "",
      bio: input.bio ?? "",
      followerCount: input.followerCount === null ? "" : String(input.followerCount),
      followingCount: input.followingCount === null ? "" : String(input.followingCount),
      location: input.locationText ?? "",
      language: decision.language ?? input.language ?? "",
      category: decision.category ?? "",
      fitScore: "",
      qualificationReason: "",
      sourcePostUrl: input.instagramPostUrl ?? "",
      sourcePostThumbnailUrl: "",
      notes: input.notes ?? "",
    },
    user.email ?? "authenticated user",
  );
  if (!created.ok) return created;

  const parsed = qualificationSchema.safeParse(decision.analysis);
  if (!parsed.success) return { ok: false, error: "The test result could not be saved." };

  const saved = await applyStoredDecision(
    supabase,
    created.id,
    { ...decision, analysis: parsed.data, calledModel: false },
    settings,
    targeting,
    user.email ?? "authenticated user",
  );
  if (!saved.ok) return { ok: true, id: created.id };
  refresh(created.id);
  return { ok: true, id: created.id };
}

function summary(decision: QualificationDecision, cached: boolean): QualifyActionResult {
  return {
    ok: true,
    cached,
    fitScore: decision.fitScore,
    fitLabel: decision.fitLabel,
    qualified: decision.qualified,
    reason: decision.analysis.qualification_reason,
    calledModel: decision.calledModel,
  };
}
