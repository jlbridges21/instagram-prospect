import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { logActivities, logActivity } from "@/lib/activity/log";
import type { Database, Json, OutreachJobRow, ProspectRow } from "@/lib/db/types";
import type { AppSettings, TargetingSettings } from "@/lib/db/models";
import { isMissingRelation } from "@/lib/db/errors";
import { outreachBlockReason } from "@/lib/outreach/eligibility";
import { nextPrepInstant, nextSendInstant } from "@/lib/outreach/scheduler";
import {
  clipError,
  failurePlan,
  jobsCancelledAfter,
  verifyDecision,
  workerMayClaim,
} from "@/lib/outreach/decisions";
import {
  followResultSchema,
  sendResultSchema,
  verifyResultSchema,
} from "@/lib/outreach/schemas";
import { isOutreachJobType, type OutreachJobType } from "@/lib/outreach/types";
import { profileUrlForUsername } from "@/lib/utils/format";
import { prospectMessage } from "@/lib/utils/message";
import { getWorkerHealth } from "@/lib/utils/worker-health";

type Client = SupabaseClient<Database>;

const queueResultSchema = z.object({
  created: z.boolean(),
  reason: z.string().optional(),
});

const OPEN_SEND_STATUSES = ["pending", "retry_wait", "claimed", "running", "completed"] as const;

export function migrationRequiredMessage() {
  return "Outreach queue is not available yet. Run the Prompt 4 database migration.";
}

function dbFailure(error: { code?: string; message?: string }) {
  if (isMissingRelation(error)) return migrationRequiredMessage();
  return "The outreach queue could not be updated.";
}

export async function loadSendOccupancy(supabase: Client) {
  const { data, error } = await supabase
    .from("outreach_jobs")
    .select("scheduled_for, completed_at, status")
    .eq("job_type", "send_message")
    .in("status", [...OPEN_SEND_STATUSES]);

  if (error) return { ok: false as const, error: dbFailure(error) };
  const occupied = (data ?? []).map((row) => new Date(row.completed_at ?? row.scheduled_for));
  return { ok: true as const, occupied };
}

export async function queueProspect(input: {
  supabase: Client;
  prospect: ProspectRow;
  settings: AppSettings;
  targeting: TargetingSettings;
  occupied: Date[];
  actor: string;
  now?: Date;
}) {
  const reason = outreachBlockReason(input.prospect, input.targeting);
  if (reason) return { ok: true as const, created: false, skipped: reason };

  const now = input.now ?? new Date();
  const message = prospectMessage({
    template: input.settings.messageTemplate,
    messageOverride: input.prospect.message_override,
    firstName: input.prospect.first_name,
    username: input.prospect.instagram_username,
  }).trim();
  if (!message) return { ok: false as const, error: "The outreach message is empty." };

  const prep = nextPrepInstant({
    now,
    timeZone: input.settings.timezone,
    settings: input.settings.outreach,
    seed: `${input.prospect.id}:prep`,
  });
  const sendAt = nextSendInstant({
    now: prep.getTime() > now.getTime() ? prep : now,
    timeZone: input.settings.timezone,
    settings: input.settings.outreach,
    occupied: input.occupied,
    seed: `${input.prospect.id}:send`,
  });

  const queued = await input.supabase.rpc("queue_outreach_sequence", {
    p_prospect_id: input.prospect.id,
    p_message: message,
    p_verify_at: prep.toISOString(),
    p_follow_at: prep.toISOString(),
    p_send_at: sendAt.toISOString(),
  });

  if (queued.error) return { ok: false as const, error: dbFailure(queued.error) };
  const parsed = queueResultSchema.safeParse(queued.data);
  if (!parsed.success) return { ok: false as const, error: "Outreach jobs could not be created." };

  if (!parsed.data.created) {
    return {
      ok: true as const,
      created: false,
      skipped: parsed.data.reason === "exists" ? null : (parsed.data.reason ?? "not eligible"),
    };
  }

  input.occupied.push(sendAt);
  await logActivity(input.supabase, {
    prospectId: input.prospect.id,
    eventType: "outreach_queued",
    description: `Queued outreach for @${input.prospect.instagram_username}.`,
    metadata: { actor: input.actor, scheduledFor: sendAt.toISOString() },
  });

  return { ok: true as const, created: true, skipped: null };
}

export function approvalSummary(input: { approved: number; queued: number; skipped: string[] }) {
  if (input.approved === 0) {
    const reason = input.skipped[0] ?? "not eligible";
    return input.skipped.length === 1
      ? `Not queued because ${reason}.`
      : `None of the selected prospects could be queued.`;
  }
  const queuedText =
    input.approved === 1 && input.queued === 1
      ? "Prospect approved and added to outreach queue."
      : `Approved ${input.approved}. ${input.queued} added to the outreach queue.`;
  if (input.skipped.length === 0) return queuedText;
  const reasons = summarizeReasons(input.skipped);
  return `${queuedText} ${input.skipped.length} skipped because ${reasons}.`;
}

function summarizeReasons(reasons: string[]) {
  const unique = [...new Set(reasons)];
  if (unique.length === 1) return unique[0];
  return unique.slice(0, 3).join(", ");
}

export async function claimNextJob(input: {
  admin: Client;
  workerId: string;
  settings: AppSettings;
  now?: Date;
  prospectId?: string | null;
}) {
  const now = input.now ?? new Date();
  const workers = await input.admin
    .from("worker_instances")
    .select("worker_id, status, last_heartbeat_at, started_at");
  if (workers.error) return { ok: false as const, error: "Could not read worker status." };

  const onlineWorkers = (workers.data ?? [])
    .filter((worker) => {
      const health = getWorkerHealth({
        status: worker.status,
        lastHeartbeatAt: worker.last_heartbeat_at,
        heartbeatIntervalSeconds: input.settings.heartbeatIntervalSeconds,
        now: now.getTime(),
      });
      return health.state === "online";
    })
    .map((worker) => ({ id: worker.worker_id, startedAt: worker.started_at }));

  const decision = workerMayClaim({
    automationEnabled: input.settings.outreach.automationEnabled,
    workerEnabled: input.settings.workerEnabled,
    requesterId: input.workerId,
    maxActiveWorkers: input.settings.maxActiveWorkers,
    onlineWorkers,
  });
  if (!decision.allowed) {
    return { ok: true as const, job: null, reason: decision.reason };
  }

  const claimed = await input.admin.rpc("claim_next_outreach_job", {
    p_worker_id: input.workerId,
    p_lease_seconds: input.settings.outreach.claimLeaseSeconds,
    p_now: now.toISOString(),
    p_prospect_id: input.prospectId ?? null,
  });
  if (claimed.error) return { ok: false as const, error: "Could not claim the next job." };
  if (!claimed.data || typeof claimed.data !== "object" || Array.isArray(claimed.data)) {
    return { ok: true as const, job: null, reason: null };
  }

  const jobId = typeof claimed.data.id === "string" ? claimed.data.id : null;
  const prospectId = typeof claimed.data.prospect_id === "string" ? claimed.data.prospect_id : null;
  const jobType = typeof claimed.data.job_type === "string" ? claimed.data.job_type : null;
  if (!jobId || !prospectId || !jobType || !isOutreachJobType(jobType)) {
    return { ok: false as const, error: "The claimed job was incomplete." };
  }

  const prospect = await input.admin
    .from("prospects")
    .select("id, instagram_username, profile_url, queued_message_text")
    .eq("id", prospectId)
    .maybeSingle();
  if (prospect.error || !prospect.data) {
    return { ok: false as const, error: "The prospect for this job is no longer available." };
  }
  if (jobType === "send_message" && !prospect.data.queued_message_text?.trim()) {
    return { ok: false as const, error: "The approved message snapshot is missing." };
  }

  await logActivity(input.admin, {
    prospectId,
    eventType: "worker_job_claimed",
    description: `Worker claimed ${jobType.replaceAll("_", " ")} for @${prospect.data.instagram_username}.`,
    metadata: { jobId, workerId: input.workerId },
  });

  return {
    ok: true as const,
    reason: null,
    job: publicJob(jobId, jobType, prospect.data),
  };
}

function publicJob(
  jobId: string,
  jobType: OutreachJobType,
  prospect: {
    id: string;
    instagram_username: string;
    profile_url: string | null;
    queued_message_text: string | null;
  },
) {
  const base = {
    id: jobId,
    type: jobType,
    prospectId: prospect.id,
    instagramUsername: prospect.instagram_username,
    profileUrl: profileUrlForUsername(prospect.instagram_username, prospect.profile_url),
  };
  if (jobType !== "send_message") return base;
  return { ...base, message: prospect.queued_message_text ?? "" };
}

async function ownedJob(admin: Client, jobId: string, workerId: string, now: Date) {
  const { data, error } = await admin.from("outreach_jobs").select("*").eq("id", jobId).maybeSingle();
  if (error) return { ok: false as const, error: "Could not read that job." };
  if (!data) return { ok: false as const, error: "That job could not be found.", status: 404 };
  if (data.claimed_by_worker_id !== workerId) {
    return { ok: false as const, error: "This job belongs to another worker.", status: 409 };
  }
  if (data.status === "completed" || data.status === "cancelled" || data.status === "failed") {
    return { ok: false as const, error: "This job is already finished.", status: 409 };
  }
  if (!data.claim_expires_at || new Date(data.claim_expires_at).getTime() <= now.getTime()) {
    return { ok: false as const, error: "The claim on this job has expired.", status: 409 };
  }
  return { ok: true as const, job: data };
}

export async function startJob(admin: Client, jobId: string, workerId: string, now = new Date()) {
  const owned = await ownedJob(admin, jobId, workerId, now);
  if (!owned.ok) return owned;
  if (owned.job.status !== "claimed" && owned.job.status !== "running") {
    return { ok: false as const, error: "This job cannot be started.", status: 409 };
  }

  const { error } = await admin
    .from("outreach_jobs")
    .update({ status: "running", started_at: owned.job.started_at ?? now.toISOString() })
    .eq("id", jobId);
  if (error) return { ok: false as const, error: "Could not start the job." };

  if (owned.job.status !== "running") {
    await logActivity(admin, {
      prospectId: owned.job.prospect_id,
      eventType: "worker_job_started",
      description: `Worker started ${owned.job.job_type.replaceAll("_", " ")}.`,
      metadata: { jobId, workerId },
    });
  }
  return { ok: true as const };
}

export async function completeJob(input: {
  admin: Client;
  jobId: string;
  workerId: string;
  result: unknown;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const owned = await ownedJob(input.admin, input.jobId, input.workerId, now);
  if (!owned.ok) return owned;
  const job = owned.job;
  if (job.status !== "claimed" && job.status !== "running") {
    return { ok: false as const, error: "This job cannot be completed.", status: 409 };
  }

  if (job.job_type === "verify_profile") return completeVerify(input.admin, job, input.result, now);
  if (job.job_type === "follow_profile") return completeFollow(input.admin, job, input.result, now);
  return completeSend(input.admin, job, input.result, now);
}

async function completeVerify(admin: Client, job: OutreachJobRow, result: unknown, now: Date) {
  const parsed = verifyResultSchema.safeParse(result);
  if (!parsed.success) return { ok: false as const, error: "Verification result was invalid.", status: 400 };
  const decision = verifyDecision(parsed.data);
  const saved = await markCompleted(admin, job, parsed.data as Json, now);
  if (!saved.ok) return saved;

  const prospect = await admin
    .from("prospects")
    .select("instagram_username")
    .eq("id", job.prospect_id)
    .maybeSingle();
  const username = prospect.data?.instagram_username ?? "account";

  if (decision.outcome === "missing") {
    await cancelJobTypes(admin, job.prospect_id, jobsCancelledAfter("verify_profile"), now, "Profile was not found.");
    await admin
      .from("prospects")
      .update({ outreach_cancelled_at: now.toISOString(), status: "skipped", last_status_changed_at: now.toISOString() })
      .eq("id", job.prospect_id);
    await logActivities(admin, [
      {
        prospectId: job.prospect_id,
        eventType: "prospect_verified",
        description: `@${username} could not be verified because the profile was not found.`,
        metadata: { jobId: job.id },
      },
      {
        prospectId: job.prospect_id,
        eventType: "outreach_cancelled",
        description: `Outreach stopped for @${username} because the profile was not found.`,
        metadata: { jobId: job.id },
      },
    ]);
    return { ok: true as const };
  }

  if (decision.outcome === "existing_follow") {
    await cancelJobTypes(admin, job.prospect_id, jobsCancelledAfter("verify_profile"), now, "Already following this account.");
    await admin
      .from("prospects")
      .update({
        already_following: true,
        outreach_cancelled_at: now.toISOString(),
      })
      .eq("id", job.prospect_id);
    await logActivity(admin, {
      prospectId: job.prospect_id,
      eventType: "prospect_excluded_existing_follow",
      description: `Outreach stopped for @${username} because the account is already followed.`,
      metadata: { jobId: job.id },
    });
    return { ok: true as const };
  }

  await logActivity(admin, {
    prospectId: job.prospect_id,
    eventType: "prospect_verified",
    description: `Verified @${username}. The account is not already followed.`,
    metadata: { jobId: job.id },
  });
  return { ok: true as const };
}

async function completeFollow(admin: Client, job: OutreachJobRow, result: unknown, now: Date) {
  const parsed = followResultSchema.safeParse(result);
  if (!parsed.success) return { ok: false as const, error: "Follow result was invalid.", status: 400 };
  if (parsed.data.skippedBecauseAlreadyFollowing) {
    const saved = await markCompleted(admin, job, parsed.data as Json, now);
    if (!saved.ok) return saved;
    await cancelJobTypes(
      admin,
      job.prospect_id,
      jobsCancelledAfter("follow_profile"),
      now,
      "Already following this account.",
    );
    await admin
      .from("prospects")
      .update({
        already_following: true,
        outreach_cancelled_at: now.toISOString(),
      })
      .eq("id", job.prospect_id);
    await logActivity(admin, {
      prospectId: job.prospect_id,
      eventType: "prospect_excluded_existing_follow",
      description: "Follow was not clicked because this account was already followed before outreach.",
      metadata: { jobId: job.id, relationshipStatus: parsed.data.relationshipStatus ?? null },
    });
    return { ok: true as const };
  }
  if (parsed.data.profileExists === false) {
    return failOwnedJob(admin, job, {
      workerId: job.claimed_by_worker_id ?? "",
      errorCode: "profile_not_found",
      errorMessage: "The profile was not available.",
      retryable: false,
      now,
    });
  }
  if (!parsed.data.followed) {
    return failOwnedJob(admin, job, {
      workerId: job.claimed_by_worker_id ?? "",
      errorCode: "follow_failed",
      errorMessage: "The follow action did not succeed.",
      retryable: true,
      now,
    });
  }
  const saved = await markCompleted(admin, job, parsed.data as Json, now);
  if (!saved.ok) return saved;
  await logActivity(admin, {
    prospectId: job.prospect_id,
    eventType: "prospect_followed",
    description: `Followed @${(await admin.from("prospects").select("instagram_username").eq("id", job.prospect_id).maybeSingle()).data?.instagram_username ?? "account"}.`,
    metadata: { jobId: job.id },
  });
  return { ok: true as const };
}

async function completeSend(admin: Client, job: OutreachJobRow, result: unknown, now: Date) {
  const parsed = sendResultSchema.safeParse(result);
  if (!parsed.success) return { ok: false as const, error: "Send result was invalid.", status: 400 };
  if (parsed.data.existingConversation) {
    const failed = await failOwnedJob(admin, job, {
      workerId: job.claimed_by_worker_id ?? "",
      errorCode: "existing_conversation",
      errorMessage: "An existing conversation was already open, so the cold message was not sent.",
      retryable: false,
      now,
    });
    if (!failed.ok) return failed;
    const prospect = await admin
      .from("prospects")
      .select("instagram_username")
      .eq("id", job.prospect_id)
      .maybeSingle();
    const username = prospect.data?.instagram_username ?? "account";
    await admin
      .from("prospects")
      .update({
        status: "review",
        outreach_cancelled_at: now.toISOString(),
        last_status_changed_at: now.toISOString(),
      })
      .eq("id", job.prospect_id);
    await cancelJobTypes(admin, job.prospect_id, jobsCancelledAfter("send_message"), now, "Existing conversation.");
    await logActivity(admin, {
      prospectId: job.prospect_id,
      eventType: "outreach_cancelled",
      description: `Did not message @${username} because a conversation already exists. The prospect needs review.`,
      metadata: { jobId: job.id, reason: "existing_conversation" },
    });
    return { ok: true as const };
  }
  if (parsed.data.profileExists === false || parsed.data.dmUnavailable) {
    return failOwnedJob(admin, job, {
      workerId: job.claimed_by_worker_id ?? "",
      errorCode: parsed.data.profileExists === false ? "profile_not_found" : "dm_unavailable",
      errorMessage: parsed.data.profileExists === false
        ? "The profile was not available."
        : "Instagram did not allow a message to this account.",
      retryable: false,
      now,
    });
  }
  if (!parsed.data.sent) {
    return failOwnedJob(admin, job, {
      workerId: job.claimed_by_worker_id ?? "",
      errorCode: "message_send_failed",
      errorMessage: "The message was not sent.",
      retryable: true,
      now,
    });
  }

  const prospect = await admin
    .from("prospects")
    .select("queued_message_text, instagram_username, outreach_cancelled_at, status, already_following")
    .eq("id", job.prospect_id)
    .maybeSingle();
  if (prospect.error || !prospect.data) {
    return { ok: false as const, error: "The prospect for this job is no longer available.", status: 404 };
  }
  if (prospect.data.outreach_cancelled_at) {
    return { ok: false as const, error: "Outreach for this prospect was cancelled.", status: 409 };
  }
  if (prospect.data.already_following) {
    const failed = await failOwnedJob(admin, job, {
      workerId: job.claimed_by_worker_id ?? "",
      errorCode: "preexisting_follow",
      errorMessage: "This account was already followed before outreach, so the message was not sent.",
      retryable: false,
      now,
    });
    if (!failed.ok) return failed;
    await admin
      .from("prospects")
      .update({ outreach_cancelled_at: now.toISOString() })
      .eq("id", job.prospect_id);
    return { ok: true as const };
  }
  const snapshot = prospect.data.queued_message_text?.trim();
  if (!snapshot) return { ok: false as const, error: "The approved message snapshot is missing.", status: 409 };

  const saved = await markCompleted(admin, job, parsed.data as Json, now);
  if (!saved.ok) return saved;

  const { error } = await admin
    .from("prospects")
    .update({
      status: "contacted",
      already_contacted: true,
      contacted_at: now.toISOString(),
      last_status_changed_at: now.toISOString(),
      sent_message_text: snapshot,
    })
    .eq("id", job.prospect_id);
  if (error) return { ok: false as const, error: "The message was recorded, but the prospect could not be updated." };

  await logActivity(admin, {
    prospectId: job.prospect_id,
    eventType: "message_sent",
    description: `Sent outreach message to @${prospect.data.instagram_username}.`,
    metadata: { jobId: job.id },
  });
  return { ok: true as const };
}

async function markCompleted(
  admin: Client,
  job: OutreachJobRow,
  result: Json,
  now: Date,
) {
  const { error } = await admin
    .from("outreach_jobs")
    .update({
      status: "completed",
      completed_at: now.toISOString(),
      result,
      last_error: null,
    })
    .eq("id", job.id);
  if (error) return { ok: false as const, error: "Could not complete the job." };
  await logActivity(admin, {
    prospectId: job.prospect_id,
    eventType: "worker_job_completed",
    description: `Worker completed ${job.job_type.replaceAll("_", " ")}.`,
    metadata: { jobId: job.id },
  });
  return { ok: true as const };
}

export async function failJob(input: {
  admin: Client;
  jobId: string;
  workerId: string;
  errorCode: string;
  errorMessage: string;
  retryable: boolean;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const owned = await ownedJob(input.admin, input.jobId, input.workerId, now);
  if (!owned.ok) return owned;
  return failOwnedJob(input.admin, owned.job, { ...input, now });
}

async function failOwnedJob(
  admin: Client,
  job: OutreachJobRow,
  input: {
    workerId: string;
    errorCode: string;
    errorMessage: string;
    retryable: boolean;
    now: Date;
  },
) {
  const plan = failurePlan({
    attemptCount: job.attempt_count,
    maxAttempts: job.max_attempts,
    retryable: input.retryable,
  });
  const errorText = clipError(input.errorMessage);
  const availableAt =
    plan.delayMinutes === null
      ? null
      : new Date(input.now.getTime() + plan.delayMinutes * 60 * 1000).toISOString();

  const { error } = await admin
    .from("outreach_jobs")
    .update({
      status: plan.status,
      attempt_count: plan.attemptCount,
      last_error: errorText,
      failed_at: plan.status === "failed" ? input.now.toISOString() : null,
      available_at: availableAt ?? job.available_at,
      claimed_by_worker_id: null,
      claimed_at: null,
      claim_expires_at: null,
      started_at: null,
      result: { error_code: input.errorCode },
    })
    .eq("id", job.id);
  if (error) return { ok: false as const, error: "Could not record the job failure." };

  if (plan.status === "failed") {
    await cancelJobTypes(
      admin,
      job.prospect_id,
      jobsCancelledAfter(job.job_type),
      input.now,
      "Blocked by an earlier failed step.",
    );
  }

  await logActivity(admin, {
    prospectId: job.prospect_id,
    eventType: "worker_job_failed",
    description:
      plan.status === "failed"
        ? `${job.job_type.replaceAll("_", " ")} failed: ${errorText}`
        : `${job.job_type.replaceAll("_", " ")} will retry: ${errorText}`,
    metadata: {
      jobId: job.id,
      errorCode: input.errorCode,
      attemptCount: plan.attemptCount,
      status: plan.status,
    },
  });
  return { ok: true as const, status: plan.status, attemptCount: plan.attemptCount };
}

async function cancelJobTypes(
  admin: Client,
  prospectId: string,
  types: OutreachJobType[],
  now: Date,
  reason: string,
) {
  if (types.length === 0) return;
  await admin
    .from("outreach_jobs")
    .update({
      status: "cancelled",
      cancelled_at: now.toISOString(),
      last_error: clipError(reason),
      claimed_by_worker_id: null,
      claimed_at: null,
      claim_expires_at: null,
    })
    .eq("prospect_id", prospectId)
    .in("job_type", types)
    .in("status", ["pending", "retry_wait", "claimed"]);
}

export async function cancelProspectOutreach(supabase: Client, prospectId: string, actor: string) {
  const now = new Date().toISOString();
  const prospect = await supabase
    .from("prospects")
    .select("id, instagram_username, status")
    .eq("id", prospectId)
    .maybeSingle();
  if (prospect.error || !prospect.data) return { ok: false as const, error: "That prospect could not be found." };

  const jobs = await supabase
    .from("outreach_jobs")
    .update({
      status: "cancelled",
      cancelled_at: now,
      last_error: "Cancelled by a user.",
      claimed_by_worker_id: null,
      claimed_at: null,
      claim_expires_at: null,
    })
    .eq("prospect_id", prospectId)
    .in("status", ["pending", "retry_wait", "claimed"])
    .select("id");
  if (jobs.error) return { ok: false as const, error: dbFailure(jobs.error) };

  const { error } = await supabase
    .from("prospects")
    .update({ outreach_cancelled_at: now })
    .eq("id", prospectId);
  if (error) return { ok: false as const, error: dbFailure(error) };

  await logActivity(supabase, {
    prospectId,
    eventType: "outreach_cancelled",
    description: `Cancelled remaining outreach for @${prospect.data.instagram_username}.`,
    metadata: { actor, cancelledJobs: jobs.data?.length ?? 0 },
  });
  return { ok: true as const };
}

export async function retryFailedJob(supabase: Client, jobId: string, actor: string) {
  const now = new Date().toISOString();
  const current = await supabase.from("outreach_jobs").select("*").eq("id", jobId).maybeSingle();
  if (current.error) return { ok: false as const, error: dbFailure(current.error) };
  if (!current.data) return { ok: false as const, error: "That job could not be found." };
  if (current.data.status !== "failed") {
    return { ok: false as const, error: "Only a failed job can be retried." };
  }

  const { error } = await supabase
    .from("outreach_jobs")
    .update({
      status: "pending",
      attempt_count: 0,
      failed_at: null,
      last_error: null,
      claimed_by_worker_id: null,
      claimed_at: null,
      claim_expires_at: null,
      started_at: null,
      available_at: now,
      scheduled_for: now,
    })
    .eq("id", jobId);
  if (error) return { ok: false as const, error: dbFailure(error) };

  await supabase
    .from("outreach_jobs")
    .update({
      status: "pending",
      last_error: null,
      cancelled_at: null,
      available_at: now,
    })
    .eq("prospect_id", current.data.prospect_id)
    .eq("status", "cancelled")
    .gt("sequence_order", current.data.sequence_order);

  await supabase
    .from("prospects")
    .update({ outreach_cancelled_at: null })
    .eq("id", current.data.prospect_id);

  await logActivity(supabase, {
    prospectId: current.data.prospect_id,
    eventType: "outreach_queued",
    description: `Retry queued for ${current.data.job_type.replaceAll("_", " ")}.`,
    metadata: { actor, jobId },
  });
  return { ok: true as const };
}

export async function rescheduleJob(supabase: Client, jobId: string, scheduledFor: Date, actor: string) {
  if (Number.isNaN(scheduledFor.getTime())) {
    return { ok: false as const, error: "Choose a valid date and time." };
  }
  const current = await supabase.from("outreach_jobs").select("*").eq("id", jobId).maybeSingle();
  if (current.error) return { ok: false as const, error: dbFailure(current.error) };
  if (!current.data) return { ok: false as const, error: "That job could not be found." };
  if (current.data.status !== "pending" && current.data.status !== "retry_wait") {
    return { ok: false as const, error: "Only a scheduled job can be moved." };
  }

  const iso = scheduledFor.toISOString();
  const { error } = await supabase
    .from("outreach_jobs")
    .update({ scheduled_for: iso, available_at: iso })
    .eq("id", jobId);
  if (error) return { ok: false as const, error: dbFailure(error) };

  await logActivity(supabase, {
    prospectId: current.data.prospect_id,
    eventType: "outreach_queued",
    description: `Rescheduled ${current.data.job_type.replaceAll("_", " ")}.`,
    metadata: { actor, jobId, scheduledFor: iso },
  });
  return { ok: true as const };
}

export async function setAutomation(supabase: Client, enabled: boolean, actor: string, cancelPending: boolean) {
  const { error } = await supabase.from("settings").update({ automation_enabled: enabled }).eq("id", 1);
  if (error) return { ok: false as const, error: dbFailure(error) };

  let cancelled = 0;
  if (!enabled && cancelPending) {
    const jobs = await supabase
      .from("outreach_jobs")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        last_error: "Cancelled when outreach was stopped.",
      })
      .in("status", ["pending", "retry_wait"])
      .select("id");
    if (jobs.error) return { ok: false as const, error: dbFailure(jobs.error) };
    cancelled = jobs.data?.length ?? 0;
  }

  await logActivity(supabase, {
    eventType: enabled ? "automation_resumed" : "automation_paused",
    description: enabled
      ? "Outreach automation resumed."
      : cancelPending
        ? "Outreach automation paused and pending jobs were cancelled."
        : "Outreach automation paused. Queued jobs were kept.",
    metadata: { actor, cancelled },
  });
  return { ok: true as const, cancelled };
}

export async function updateQueuedMessage(supabase: Client, prospectId: string, message: string) {
  const trimmed = message.trim();
  if (!trimmed) return { ok: false as const, error: "The message cannot be empty." };
  if (trimmed.length > 5000) return { ok: false as const, error: "The message is too long." };

  const sendJob = await supabase
    .from("outreach_jobs")
    .select("status")
    .eq("prospect_id", prospectId)
    .eq("job_type", "send_message")
    .maybeSingle();
  if (sendJob.error) {
    if (isMissingRelation(sendJob.error)) return { ok: false as const, error: migrationRequiredMessage() };
    return { ok: false as const, error: "Could not check the send job." };
  }
  if (sendJob.data && (sendJob.data.status === "running" || sendJob.data.status === "completed" || sendJob.data.status === "claimed")) {
    return { ok: false as const, error: "The send has already started, so the locked message cannot change." };
  }

  const { error } = await supabase
    .from("prospects")
    .update({ queued_message_text: trimmed })
    .eq("id", prospectId);
  if (error) return { ok: false as const, error: dbFailure(error) };
  return { ok: true as const };
}
