import { DEFAULT_MAX_ATTEMPTS, RETRY_DELAY_MINUTES } from "@/lib/outreach/defaults";
import { WORKER_ERROR_CODES, type OutreachJobType, type WorkerErrorCode } from "@/lib/outreach/types";

export type VerifyResult = {
  profileExists: boolean;
  alreadyFollowing: boolean;
};

export type VerifyDecision =
  | { outcome: "continue" }
  | { outcome: "missing" }
  | { outcome: "existing_follow" };

export function verifyDecision(result: VerifyResult): VerifyDecision {
  if (!result.profileExists) return { outcome: "missing" };
  if (result.alreadyFollowing) return { outcome: "existing_follow" };
  return { outcome: "continue" };
}

export function jobsCancelledAfter(type: OutreachJobType): OutreachJobType[] {
  if (type === "verify_profile") return ["follow_profile", "send_message"];
  if (type === "follow_profile") return ["send_message"];
  return [];
}

export function failurePlan(input: {
  attemptCount: number;
  maxAttempts?: number;
  retryable: boolean;
}) {
  const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const attemptCount = input.attemptCount + 1;
  if (!input.retryable || attemptCount >= maxAttempts) {
    return { attemptCount, status: "failed" as const, delayMinutes: null };
  }
  const delayMinutes =
    RETRY_DELAY_MINUTES[Math.min(attemptCount, RETRY_DELAY_MINUTES.length) - 1] ?? 60;
  return { attemptCount, status: "retry_wait" as const, delayMinutes };
}

export function workerMayClaim(input: {
  automationEnabled: boolean;
  workerEnabled: boolean;
  requesterId: string;
  maxActiveWorkers: number;
  onlineWorkers: { id: string; startedAt: string | null }[];
}) {
  if (!input.workerEnabled) {
    return { allowed: false as const, reason: "worker_disabled" as const };
  }
  if (!input.automationEnabled) {
    return { allowed: false as const, reason: "automation_paused" as const };
  }
  const requester = input.onlineWorkers.find((worker) => worker.id === input.requesterId);
  if (!requester) {
    return { allowed: false as const, reason: "heartbeat_required" as const };
  }

  const ranked = [...input.onlineWorkers].sort((left, right) => {
    const leftStamp = left.startedAt ?? "9999";
    const rightStamp = right.startedAt ?? "9999";
    if (leftStamp === rightStamp) return left.id.localeCompare(right.id);
    return leftStamp < rightStamp ? -1 : 1;
  });
  const allowed = ranked.slice(0, Math.max(input.maxActiveWorkers, 1));
  if (!allowed.some((worker) => worker.id === input.requesterId)) {
    return { allowed: false as const, reason: "another_worker_active" as const };
  }
  return { allowed: true as const, reason: null };
}

export function clipError(message: string) {
  const trimmed = message.trim();
  if (!trimmed) return "The worker reported a failure.";
  return trimmed.slice(0, 500);
}

export function isWorkerErrorCode(value: string): value is WorkerErrorCode {
  return WORKER_ERROR_CODES.some((code) => code === value);
}
