import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppSettings } from "@/lib/db/models";
import type { Database } from "@/lib/db/types";
import { isOutreachJobType, type OutreachJobType } from "@/lib/outreach/types";
import { profileUrlForUsername } from "@/lib/utils/format";

type Client = SupabaseClient<Database>;

export async function previewNextJob(admin: Client, settings: AppSettings) {
  if (!settings.workerEnabled) {
    return { ok: true as const, job: null, reason: "worker_disabled" as const };
  }
  const now = new Date().toISOString();
  const jobs = await admin
    .from("outreach_jobs")
    .select("id, job_type, prospect_id, depends_on_job_id, sequence_order")
    .in("status", ["pending", "retry_wait"])
    .lte("available_at", now)
    .order("sequence_order", { ascending: true })
    .limit(30);
  if (jobs.error) return { ok: false as const, error: "Could not read the outreach queue." };

  for (const job of jobs.data ?? []) {
    if (!isOutreachJobType(job.job_type)) continue;
    if (job.depends_on_job_id) {
      const dependency = await admin
        .from("outreach_jobs")
        .select("status")
        .eq("id", job.depends_on_job_id)
        .maybeSingle();
      if (dependency.data?.status !== "completed") continue;
    }
    const prospect = await admin
      .from("prospects")
      .select("id, instagram_username, profile_url, queued_message_text, status")
      .eq("id", job.prospect_id)
      .maybeSingle();
    if (!prospect.data || prospect.data.status !== "approved") continue;
    return {
      ok: true as const,
      job: publicPreview(job.id, job.job_type, prospect.data),
      reason: null,
    };
  }

  return { ok: true as const, job: null, reason: "no_job" as const };
}

export async function previewProspectSequence(admin: Client) {
  const next = await admin
    .from("outreach_jobs")
    .select("prospect_id, scheduled_for")
    .in("status", ["pending", "retry_wait"])
    .order("scheduled_for", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (next.error) return { ok: false as const, error: "Could not read the outreach queue." };
  if (!next.data) {
    return { ok: true as const, sequence: null, reason: "no_queued_jobs" as const };
  }

  const prospect = await admin
    .from("prospects")
    .select("id, instagram_username, profile_url, queued_message_text, status")
    .eq("id", next.data.prospect_id)
    .maybeSingle();
  if (prospect.error || !prospect.data) {
    return { ok: false as const, error: "The queued prospect could not be loaded." };
  }

  const jobs = await admin
    .from("outreach_jobs")
    .select("job_type, status, scheduled_for, idempotency_key, created_at")
    .eq("prospect_id", prospect.data.id);
  if (jobs.error) return { ok: false as const, error: "Could not read the prospect sequence." };

  const version = latestVersion(jobs.data ?? []);
  const steps = (jobs.data ?? [])
    .filter((job) => job.idempotency_key.endsWith(`:outreach-v${version}`))
    .sort((left, right) => left.scheduled_for.localeCompare(right.scheduled_for));

  return {
    ok: true as const,
    reason: null,
    sequence: {
      prospectId: prospect.data.id,
      instagramUsername: prospect.data.instagram_username,
      profileUrl: profileUrlForUsername(prospect.data.instagram_username, prospect.data.profile_url),
      message: prospect.data.queued_message_text ?? "",
      status: prospect.data.status,
      steps: steps.map((job) => ({
        type: job.job_type,
        status: job.status,
        scheduledFor: job.scheduled_for,
      })),
    },
  };
}

function latestVersion(jobs: Array<{ idempotency_key: string }>) {
  let version = 1;
  for (const job of jobs) {
    const match = job.idempotency_key.match(/:outreach-v(\d+)$/);
    if (match) version = Math.max(version, Number(match[1]));
  }
  return version;
}

function publicPreview(
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
