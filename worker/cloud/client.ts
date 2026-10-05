import { AUTH_FAILURE_MESSAGE } from "../version";

export type CloudConfig = {
  workerEnabled: boolean;
  automationEnabled: boolean;
  discoveryEnabled: boolean;
  heartbeatIntervalSeconds: number;
  maxProfilesPerSession: number;
  maxProfilesPerHour: number;
  discoveryScrollDelaySeconds: number;
  discoveryDuplicateCooldownDays: number;
  minSupportedWorkerVersion: string | null;
  homeFeedEnabled: boolean;
  suggestedAccountsEnabled: boolean;
  discoverySourcePriority: "suggested_first" | "home_first";
  candidateQueueTarget: number;
  profileInspectionConcurrency: number;
  reviewTarget: number | "unlimited";
  sessionInspectionCap: number;
  dailyInspectionCap: number;
  dailyAiCap: number;
  discoveryStopReason: string | null;
  discoveryRunMode: "review_target" | "duration" | "inspection_count" | "continuous";
  discoveryRunMinutes: number | null;
  discoveryRunInspectionLimit: number | null;
  discoveryRunStartedAt: string | null;
  timezone: string;
};

export const CONFIG_CACHE_MS = 60_000;

export function shouldRefreshConfig(cachedAt: number | null, now: number) {
  return cachedAt === null || now - cachedAt >= CONFIG_CACHE_MS;
}

export type ProspectCheck = {
  username?: string;
  exists: boolean;
  prospectId: string | null;
  status: string | null;
  alreadyContacted: boolean;
  alreadyFollowing: boolean;
  discoveredAt: string | null;
  skip: boolean;
};

export type JobPayload = {
  id: string;
  type: "verify_profile" | "follow_profile" | "send_message";
  prospectId: string;
  instagramUsername: string;
  profileUrl: string;
  message?: string;
  followClickAttempted?: boolean;
  executionStarted?: boolean;
  verifyNotFollowing?: boolean;
  followCreatedBySequence?: boolean;
  sendAttempted?: boolean;
};

export class CloudClient {
  private configCachedAt: number | null = null;
  private configCache: CloudConfig | null = null;
  cloudRequests = 0;

  constructor(
    private readonly baseUrl: string,
    private readonly secret: string,
  ) {}

  async heartbeat(body: Record<string, unknown>) {
    return this.request<{ ok: boolean; next_command?: { commandId: string; type: string; payload: unknown } | null }>("/api/worker/heartbeat", body);
  }

  invalidateConfig() {
    this.configCachedAt = null;
  }

  async claimCommand(workerId: string, commandId: string) {
    return this.request<{ ok: boolean; type: string; payload: Record<string, unknown>; applied: boolean; error?: string }>(
      "/api/worker/commands/claim",
      { worker_id: workerId, command_id: commandId },
    );
  }

  async finishCommand(workerId: string, commandId: string, ok: boolean, result?: Record<string, unknown>, errorMessage?: string) {
    return this.request<{ ok: boolean }>("/api/worker/commands/complete", {
      worker_id: workerId,
      command_id: commandId,
      ok,
      result: result ?? {},
      error_message: errorMessage,
      error_code: ok ? undefined : "command_failed",
    });
  }

  async finishDiscoveryRun() {
    return this.request<{ ok: boolean }>("/api/worker/discovery/finish-run", {});
  }

  async config() {
    if (!shouldRefreshConfig(this.configCachedAt, Date.now()) && this.configCache) return this.configCache;
    this.cloudRequests += 1;
    const response = await fetch(`${this.baseUrl}/api/worker/config`, {
      headers: { authorization: `Bearer ${this.secret}` },
      redirect: "manual",
    });
    if (response.status === 401) throw authError();
    if (!response.ok) throw new Error(`Cloud config returned ${response.status}.`);
    const json = (await response.json()) as Record<string, unknown>;
    const value = {
      workerEnabled: Boolean(json.workerEnabled),
      automationEnabled: Boolean(json.automationEnabled),
      discoveryEnabled: json.discoveryEnabled !== false,
      heartbeatIntervalSeconds: numberOr(json.heartbeatIntervalSeconds, 30),
      maxProfilesPerSession: numberOr(json.maxProfilesPerSession, 50),
      maxProfilesPerHour: numberOr(json.maxProfilesPerHour, 30),
      discoveryScrollDelaySeconds: numberOr(json.discoveryScrollDelaySeconds, 5),
      discoveryDuplicateCooldownDays: numberOr(json.discoveryDuplicateCooldownDays, 30),
      minSupportedWorkerVersion: typeof json.minSupportedWorkerVersion === "string" ? json.minSupportedWorkerVersion : null,
      homeFeedEnabled: json.homeFeedEnabled !== false,
      suggestedAccountsEnabled: json.suggestedAccountsEnabled !== false,
      discoverySourcePriority: json.discoverySourcePriority === "home_first" ? "home_first" : "suggested_first",
      candidateQueueTarget: numberOr(json.candidateQueueTarget, 10),
      profileInspectionConcurrency: 2,
      reviewTarget: json.reviewTarget === "unlimited" || json.reviewTarget == null ? "unlimited" : numberOr(json.reviewTarget, 50),
      sessionInspectionCap: numberOr(json.sessionInspectionCap, 1000),
      dailyInspectionCap: numberOr(json.dailyInspectionCap, 500),
      dailyAiCap: numberOr(json.dailyAiCap, 300),
      discoveryStopReason: typeof json.discoveryStopReason === "string" ? json.discoveryStopReason : null,
      discoveryRunMode: json.discoveryRunMode === "duration" || json.discoveryRunMode === "inspection_count" || json.discoveryRunMode === "continuous" ? json.discoveryRunMode : "review_target",
      discoveryRunMinutes: typeof json.discoveryRunMinutes === "number" ? json.discoveryRunMinutes : null,
      discoveryRunInspectionLimit: typeof json.discoveryRunInspectionLimit === "number" ? json.discoveryRunInspectionLimit : null,
      discoveryRunStartedAt: typeof json.discoveryRunStartedAt === "string" ? json.discoveryRunStartedAt : null,
      timezone: typeof json.timezone === "string" && json.timezone ? json.timezone : "America/Chicago",
    } satisfies CloudConfig;
    this.configCache = value;
    this.configCachedAt = Date.now();
    return value;
  }

  async recheckRelationship(username: string, relationship: "following" | "not_following" | "requested" | "unknown") {
    return this.request<{ applied: boolean; relationship: string; reason?: string; prospectId?: string }>(
      "/api/worker/prospects/recheck",
      { instagram_username: username, follow_relationship: relationship },
    );
  }

  async checkProspects(usernames: string[]) {
    return this.request<{ results: ProspectCheck[] }>("/api/worker/prospects/check", { usernames });
  }

  async checkProspect(username: string) {
    this.cloudRequests += 1;
    const url = new URL("/api/worker/prospects/check", this.baseUrl);
    url.searchParams.set("username", username);
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${this.secret}` },
      redirect: "manual",
    });
    if (response.status === 401) throw authError();
    if (!response.ok) throw new Error(`Prospect check returned ${response.status}.`);
    return (await response.json()) as ProspectCheck;
  }

  async ingestProspect(body: Record<string, unknown>) {
    return this.request<{ created: boolean; prospectId?: string; status?: string; reason?: string; shouldQualify?: boolean }>(
      "/api/worker/prospects",
      body,
    );
  }

  async discoveryProgress(body: { inspections?: number; ai?: number; emptyCycles?: number }) {
    return this.request<{ pause: boolean; reason: string | null }>("/api/worker/discovery/progress", body);
  }

  async qualifyProspect(prospectId: string) {
    return this.request<{
      ok: boolean;
      status?: string;
      fitLabel?: string;
      fitScore?: number;
      category?: string | null;
      skipped?: boolean;
      prospectId?: string;
    }>(`/api/worker/prospects/${prospectId}/qualify`, {});
  }

  async nextJob(workerId: string, prospectId?: string, options?: { recoverOnly?: boolean }) {
    return this.request<{
      job: JobPayload | null;
      reason?: string | null;
      message?: string | null;
      nextAt?: string | null;
      nextCheckAfterSeconds?: number;
    }>("/api/worker/jobs/next", {
      worker_id: workerId,
      prospect_id: prospectId,
      recover_only: options?.recoverOnly,
    });
  }

  async previewLockedMessage(username: string) {
    const response = await fetch(`${this.baseUrl}/api/worker/jobs/preview?username=${encodeURIComponent(username)}`, {
      headers: { authorization: `Bearer ${this.secret}` },
      redirect: "manual",
    });
    if (response.status === 401) throw authError();
    if (!response.ok) throw new Error(`Locked message preview returned ${response.status}.`);
    return (await response.json()) as { instagramUsername: string; message: string | null };
  }

  async previewJob() {
    const response = await fetch(`${this.baseUrl}/api/worker/jobs/preview`, {
      headers: { authorization: `Bearer ${this.secret}` },
      redirect: "manual",
    });
    if (response.status === 401) throw authError();
    if (!response.ok) throw new Error(`Job preview returned ${response.status}.`);
    return (await response.json()) as {
      job: JobPayload | null;
      reason?: string | null;
      outreachPaused?: boolean;
      sequence?: {
        instagramUsername: string;
        message: string;
        steps: Array<{ type: string; status: string; scheduledFor: string; result?: unknown }>;
      } | null;
    };
  }

  async startJob(jobId: string, workerId: string) {
    return this.request<{ ok: boolean }>(`/api/worker/jobs/${jobId}/start`, { worker_id: workerId });
  }

  async completeJob(jobId: string, workerId: string, result: Record<string, unknown>) {
    return this.request<{ ok: boolean }>(`/api/worker/jobs/${jobId}/complete`, { worker_id: workerId, result });
  }

  async failJob(jobId: string, workerId: string, body: Record<string, unknown>) {
    return this.request<{ ok: boolean }>(`/api/worker/jobs/${jobId}/fail`, { worker_id: workerId, ...body });
  }

  private async request<T>(pathname: string, body: Record<string, unknown>): Promise<T & { statusCode: number }> {
    this.cloudRequests += 1;
    const response = await fetch(`${this.baseUrl}${pathname}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      redirect: "manual",
    });
    const json = (await response.json().catch(() => ({}))) as T;
    if (!response.ok) {
      if (response.status === 401) throw authError();
      const message = typeof (json as { error?: unknown }).error === "string"
        ? (json as { error: string }).error
        : `Cloud request failed (${response.status}).`;
      const error = new Error(message) as Error & { statusCode: number };
      error.statusCode = response.status;
      throw error;
    }
    return { ...json, statusCode: response.status };
  }
}

function authError() {
  const error = new Error(AUTH_FAILURE_MESSAGE) as Error & { statusCode: number };
  error.statusCode = 401;
  return error;
}

function numberOr(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
