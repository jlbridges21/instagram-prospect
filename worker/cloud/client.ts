export type CloudConfig = {
  workerEnabled: boolean;
  automationEnabled: boolean;
  discoveryEnabled: boolean;
  heartbeatIntervalSeconds: number;
  maxProfilesPerSession: number;
  maxProfilesPerHour: number;
  discoveryScrollDelaySeconds: number;
  discoveryDuplicateCooldownDays: number;
};

export type ProspectCheck = {
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
};

export class CloudClient {
  constructor(
    private readonly baseUrl: string,
    private readonly secret: string,
  ) {}

  async heartbeat(body: Record<string, unknown>) {
    return this.request<{ ok: boolean }>("/api/worker/heartbeat", body);
  }

  async config() {
    const response = await fetch(`${this.baseUrl}/api/worker/config`, {
      headers: { authorization: `Bearer ${this.secret}` },
      redirect: "manual",
    });
    if (!response.ok) throw new Error(`Cloud config returned ${response.status}.`);
    const json = (await response.json()) as Record<string, unknown>;
    return {
      workerEnabled: Boolean(json.workerEnabled),
      automationEnabled: Boolean(json.automationEnabled),
      discoveryEnabled: json.discoveryEnabled !== false,
      heartbeatIntervalSeconds: numberOr(json.heartbeatIntervalSeconds, 30),
      maxProfilesPerSession: numberOr(json.maxProfilesPerSession, 50),
      maxProfilesPerHour: numberOr(json.maxProfilesPerHour, 30),
      discoveryScrollDelaySeconds: numberOr(json.discoveryScrollDelaySeconds, 5),
      discoveryDuplicateCooldownDays: numberOr(json.discoveryDuplicateCooldownDays, 30),
    } satisfies CloudConfig;
  }

  async checkProspect(username: string) {
    const url = new URL("/api/worker/prospects/check", this.baseUrl);
    url.searchParams.set("username", username);
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${this.secret}` },
      redirect: "manual",
    });
    if (!response.ok) throw new Error(`Prospect check returned ${response.status}.`);
    return (await response.json()) as ProspectCheck;
  }

  async ingestProspect(body: Record<string, unknown>) {
    return this.request<{ created: boolean; prospectId?: string; status?: string; reason?: string }>(
      "/api/worker/prospects",
      body,
    );
  }

  async qualifyProspect(prospectId: string) {
    return this.request<{ ok: boolean; status?: string; fitLabel?: string; skipped?: boolean }>(
      `/api/worker/prospects/${prospectId}/qualify`,
      {},
    );
  }

  async nextJob(workerId: string) {
    return this.request<{ job: JobPayload | null; reason?: string | null; nextCheckAfterSeconds?: number }>(
      "/api/worker/jobs/next",
      { worker_id: workerId },
    );
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
      const message = typeof (json as { error?: unknown }).error === "string" ? (json as { error: string }).error : `Cloud request failed (${response.status}).`;
      const error = new Error(message) as Error & { statusCode: number };
      error.statusCode = response.status;
      throw error;
    }
    return { ...json, statusCode: response.status };
  }
}

function numberOr(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
