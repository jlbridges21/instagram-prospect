import { failurePlan } from "@/lib/outreach/decisions";
import { RETRY_DELAY_MINUTES } from "@/lib/outreach/defaults";
import { sendWasAttempted } from "@/lib/outreach/dm";

export const PERSIST_RETRY_DELAYS_MS = [2_000, 5_000, 15_000] as const;

export function recordedFailureCode(result: unknown) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const code = (result as { error_code?: unknown }).error_code;
  return typeof code === "string" ? code : null;
}

export function isSafeUnsentFailure(result: unknown, lastError: string | null | undefined) {
  if (sendWasAttempted(result)) return false;
  const code = recordedFailureCode(result);
  if (
    code === "recipient_confirmation_failed" ||
    code === "recipient_detection_unresolved" ||
    code === "ui_structure_unknown" ||
    code === "message_unavailable" ||
    code === "composer_unavailable" ||
    code === "dm_unavailable" ||
    code === "dm_composer_not_found" ||
    code === "composer_text_mismatch" ||
    code === "message_send_failed" ||
    code === "existing_draft_mismatch"
  ) {
    return true;
  }
  return /recipient|thread identity|composer_text_mismatch|existing_draft_mismatch/i.test(lastError ?? "");
}

export function existingFailureRecord(job: {
  status: string;
  attempt_count: number;
  result: unknown;
}, errorCode: string) {
  if (job.status !== "retry_wait" && job.status !== "failed") return null;
  if (recordedFailureCode(job.result) !== errorCode) return null;
  return { status: job.status as "retry_wait" | "failed", attemptCount: job.attempt_count };
}

export function cappedFailurePlan(input: { attemptCount: number; maxAttempts: number; retryable: boolean }) {
  const maxStored = input.maxAttempts + 1;
  if (input.attemptCount >= input.maxAttempts) {
    return {
      attemptCount: Math.min(input.attemptCount, maxStored),
      status: "failed" as const,
      delayMinutes: null as number | null,
      incremented: false,
    };
  }
  const plan = failurePlan(input);
  return {
    attemptCount: Math.min(plan.attemptCount, maxStored),
    status: plan.status,
    delayMinutes: plan.delayMinutes,
    incremented: true,
  };
}

export function retryDelayMinutes(attemptCount: number, maxAttempts: number) {
  if (attemptCount >= maxAttempts) return null;
  const index = Math.min(Math.max(attemptCount, 1), RETRY_DELAY_MINUTES.length) - 1;
  return RETRY_DELAY_MINUTES[index] ?? 60;
}

export function reconcileRunningSend(job: {
  job_type: string;
  status: string;
  attempt_count: number;
  max_attempts: number;
  available_at: string;
  result: unknown;
  last_error: string | null;
}, now: Date) {
  if (job.job_type !== "send_message") return null;
  if (job.status !== "running" && job.status !== "claimed") return null;
  if (sendWasAttempted(job.result)) return null;

  const code = recordedFailureCode(job.result);
  const delayMinutes = code === "existing_draft_mismatch" ? null : retryDelayMinutes(job.attempt_count, job.max_attempts);
  const clearClaim = {
    claimed_by_worker_id: null,
    claimed_at: null,
    claim_expires_at: null,
    started_at: null,
    attempt_count: Math.min(job.attempt_count, job.max_attempts + 1),
  };
  if (delayMinutes == null) {
    return {
      ...clearClaim,
      status: "failed" as const,
      failed_at: now.toISOString(),
      available_at: job.available_at,
    };
  }
  return {
    ...clearClaim,
    status: "retry_wait" as const,
    failed_at: null,
    available_at: new Date(now.getTime() + delayMinutes * 60 * 1000).toISOString(),
  };
}

export function persistenceRetryDelayMs(failedWrites: number) {
  if (failedWrites <= 0 || failedWrites > PERSIST_RETRY_DELAYS_MS.length) return null;
  return PERSIST_RETRY_DELAYS_MS[failedWrites - 1] ?? null;
}

export async function persistFailure(input: {
  write: () => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  log: (message: string) => void;
}) {
  let failedWrites = 0;
  let lastError: unknown = null;
  for (;;) {
    try {
      await input.write();
      return { ok: true as const, attempts: failedWrites + 1 };
    } catch (error) {
      lastError = error;
      failedWrites += 1;
      const delay = persistenceRetryDelayMs(failedWrites);
      if (delay == null) {
        return { ok: false as const, attempts: failedWrites, error: lastError };
      }
      input.log(`Retry-state write failed.\nRetrying state sync ${failedWrites}/3...`);
      await input.sleep(delay);
    }
  }
}

export class JobQuarantine {
  private jobs = new Map<string, { username: string; browserRuns: number; blocked: boolean }>();

  noteBrowserRun(jobId: string, username: string) {
    const current = this.jobs.get(jobId) ?? { username, browserRuns: 0, blocked: false };
    current.browserRuns += 1;
    current.username = username;
    this.jobs.set(jobId, current);
    return current.browserRuns;
  }

  allowsBrowser(jobId: string) {
    return !this.jobs.has(jobId);
  }

  browserRuns(jobId: string) {
    return this.jobs.get(jobId)?.browserRuns ?? 0;
  }

  markBlocked(jobId: string) {
    const current = this.jobs.get(jobId);
    if (current) current.blocked = true;
  }

  clear(jobId: string) {
    this.jobs.delete(jobId);
  }

  blockedJob() {
    for (const [jobId, job] of this.jobs) {
      if (job.blocked) return { jobId, username: job.username };
    }
    return null;
  }
}
