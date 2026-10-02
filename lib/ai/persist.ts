import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { logActivity } from "@/lib/activity/log";
import { estimateQualificationCost, QUALIFICATION_MODEL } from "@/lib/ai/config";
import { evaluateProspect, qualificationFingerprint } from "@/lib/ai/evaluate";
import { rulesFromTargeting } from "@/lib/ai/openai";
import { qualificationSchema } from "@/lib/ai/schemas";
import type { QualificationDecision, QualificationInput } from "@/lib/ai/types";
import { FIT_LABELS_TEXT, type ProspectStatus } from "@/lib/constants/prospects";
import type { AppSettings, TargetingSettings } from "@/lib/db/models";
import type { Database, Json, ProspectRow } from "@/lib/db/types";

type Client = SupabaseClient<Database>;

const LOCKED_STATUSES: ProspectStatus[] = [
  "approved",
  "contacted",
  "replied",
  "follow_up",
  "demo_booked",
  "converted",
  "skipped",
];

export type StoredQualification = {
  decision: QualificationDecision;
  cached: boolean;
  statusChanged: boolean;
};

export function inputFromProspect(row: ProspectRow): QualificationInput {
  return {
    instagramUsername: row.instagram_username,
    displayName: row.display_name,
    firstName: row.first_name,
    bio: row.bio,
    followerCount: row.follower_count,
    followingCount: row.following_count,
    locationText: row.location_text,
    language: row.language,
    category: row.category,
    alreadyFollowing: row.already_following,
    alreadyContacted: row.already_contacted,
    instagramPostUrl: row.instagram_post_url,
    notes: row.notes,
    sourceContext: null,
  };
}

export async function qualifyStoredProspect(
  supabase: Client,
  prospectId: string,
  settings: AppSettings,
  targeting: TargetingSettings,
  options: { force?: boolean; actor: string },
): Promise<{ ok: true; result: StoredQualification } | { ok: false; error: string }> {
  const { data: prospect, error } = await supabase
    .from("prospects")
    .select("*")
    .eq("id", prospectId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!prospect) return { ok: false, error: "That prospect could not be found." };

  const rules = rulesFromTargeting(targeting, {
    strongFitMinimum: settings.strongFitMinimum,
    possibleFitMinimum: settings.possibleFitMinimum,
  });
  const input = inputFromProspect(prospect);
  const hash = qualificationFingerprint(input, rules);

  if (!options.force && prospect.ai_input_hash === hash && prospect.ai_analysis) {
    const cached = qualificationSchema.safeParse(prospect.ai_analysis);
    if (cached.success) {
      return {
        ok: true,
        result: {
          cached: true,
          statusChanged: false,
          decision: {
            analysis: cached.data,
            fitScore: cached.data.fit_score,
            fitLabel: cached.data.fit_label,
            category: cached.data.category,
            qualified: cached.data.qualified,
            status: cached.data.qualified ? "review" : "disqualified",
            firstName: prospect.first_name,
            language: prospect.language,
            calledModel: false,
            inputTokens: null,
            outputTokens: null,
          },
        },
      };
    }
  }

  const evaluated = await evaluateProspect(input, rules, targeting, {
    allowModel: settings.aiEnabled,
  });
  if (!evaluated.ok) return evaluated;
  return saveDecision(supabase, prospect, evaluated.decision, hash, options.actor, true);
}

export async function applyStoredDecision(
  supabase: Client,
  prospectId: string,
  decision: QualificationDecision,
  settings: AppSettings,
  targeting: TargetingSettings,
  actor: string,
) {
  const { data: prospect, error } = await supabase
    .from("prospects")
    .select("*")
    .eq("id", prospectId)
    .maybeSingle();
  if (error) return { ok: false as const, error: error.message };
  if (!prospect) return { ok: false as const, error: "That prospect could not be found." };

  const rules = rulesFromTargeting(targeting, {
    strongFitMinimum: settings.strongFitMinimum,
    possibleFitMinimum: settings.possibleFitMinimum,
  });
  const hash = qualificationFingerprint(inputFromProspect(prospect), rules);
  return saveDecision(supabase, prospect, decision, hash, actor, decision.calledModel);
}

async function saveDecision(
  supabase: Client,
  prospect: ProspectRow,
  decision: QualificationDecision,
  hash: string,
  actor: string,
  recordUsage: boolean,
) {
  const locked = LOCKED_STATUSES.some((status) => status === prospect.status);
  const nextStatus = locked ? prospect.status : decision.status;
  const now = new Date().toISOString();

  const { error } = await supabase
    .from("prospects")
    .update({
      qualified: decision.qualified,
      fit_score: decision.fitScore,
      fit_label: decision.fitLabel,
      category: decision.category,
      qualification_reason: decision.analysis.qualification_reason,
      first_name: decision.firstName,
      language: decision.language,
      status: nextStatus,
      last_status_changed_at: nextStatus === prospect.status ? prospect.last_status_changed_at : now,
      ai_analysis: JSON.parse(JSON.stringify(decision.analysis)) as Json,
      ai_analyzed_at: now,
      ai_model: decision.calledModel ? QUALIFICATION_MODEL : "rules",
      ai_input_hash: hash,
    })
    .eq("id", prospect.id);

  if (error) return { ok: false as const, error: error.message };

  if (recordUsage && decision.calledModel) {
    await supabase.from("ai_usage").insert({
      prospect_id: prospect.id,
      model: QUALIFICATION_MODEL,
      operation: "qualify_prospect",
      input_tokens: decision.inputTokens,
      output_tokens: decision.outputTokens,
      estimated_cost_usd:
        decision.inputTokens !== null && decision.outputTokens !== null
          ? estimateQualificationCost(decision.inputTokens, decision.outputTokens)
          : null,
    });
  }

  const eventType = decision.qualified ? "prospect_qualified" : "prospect_disqualified";
  await logActivity(supabase, {
    prospectId: prospect.id,
    eventType,
    description: decision.qualified
      ? `Qualified @${prospect.instagram_username} for review. ${FIT_LABELS_TEXT[decision.fitLabel]}, score ${decision.fitScore}.`
      : `Disqualified @${prospect.instagram_username}. ${decision.analysis.qualification_reason}`,
    metadata: {
      fit_score: decision.fitScore,
      fit_label: decision.fitLabel,
      category: decision.category,
      exclusion_reason: decision.analysis.exclusion_reason,
      actor,
    },
  });

  return {
    ok: true as const,
    result: {
      decision,
      cached: false,
      statusChanged: nextStatus !== prospect.status,
    },
  };
}
