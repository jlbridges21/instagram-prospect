import { z } from "zod";

export const WORKER_COMMAND_TYPES = [
  "start_discovery",
  "pause_discovery",
  "stop_discovery",
  "start_outreach",
  "pause_outreach",
  "run_discovery_test",
  "run_outreach_preview",
  "run_one_outreach",
  "recover_outreach",
  "inspect_dm",
  "inspect_composer",
  "refresh_instagram_auth_check",
  "clear_worker_attention",
  "restart_browser_session_if_safe",
] as const;

export type WorkerCommandType = (typeof WORKER_COMMAND_TYPES)[number];

export const WORKER_COMMAND_STATUSES = ["queued", "claimed", "running", "completed", "failed", "cancelled", "expired"] as const;

const username = z.string().trim().regex(/^[A-Za-z0-9._]{1,30}$/);

const discoveryPayload = z.object({
  mode: z.enum(["review_target", "duration", "inspection_count", "continuous"]),
  reviewTarget: z.number().int().min(1).max(5000).optional(),
  durationMinutes: z.number().int().min(1).max(24 * 60).optional(),
  inspectionCount: z.number().int().min(1).max(5000).optional(),
  hourlyPace: z.number().int().min(1).max(200).optional(),
  suggestedAccounts: z.boolean().optional(),
  homeFeed: z.boolean().optional(),
}).strict();

const usernamePayload = z.object({ username }).strict();
const emptyPayload = z.object({}).strict();

const payloadByType = {
  start_discovery: discoveryPayload,
  pause_discovery: emptyPayload,
  stop_discovery: emptyPayload,
  start_outreach: emptyPayload,
  pause_outreach: emptyPayload,
  run_discovery_test: emptyPayload,
  run_outreach_preview: emptyPayload,
  run_one_outreach: emptyPayload,
  recover_outreach: emptyPayload,
  inspect_dm: usernamePayload,
  inspect_composer: usernamePayload,
  refresh_instagram_auth_check: emptyPayload,
  clear_worker_attention: emptyPayload,
  restart_browser_session_if_safe: emptyPayload,
} as const;

const BLOCKED_KEYS = ["shell", "command", "script", "powershell", "cmd", "path", "code", "eval"];

export function commandPriority(type: WorkerCommandType) {
  if (type === "pause_discovery" || type === "stop_discovery" || type === "pause_outreach") return 1;
  if (type === "clear_worker_attention" || type === "refresh_instagram_auth_check" || type === "restart_browser_session_if_safe") return 2;
  if (type === "start_outreach" || type === "run_one_outreach" || type === "recover_outreach" || type === "run_outreach_preview") return 3;
  if (type === "start_discovery") return 4;
  return 5;
}

export function immediateCommand(type: WorkerCommandType) {
  return type === "pause_discovery" || type === "stop_discovery" || type === "pause_outreach" || type === "clear_worker_attention";
}

export function parseWorkerCommand(input: { type: unknown; payload?: unknown }) {
  if (typeof input.type !== "string" || !WORKER_COMMAND_TYPES.includes(input.type as WorkerCommandType)) {
    return { ok: false as const, error: "That worker command is not allowed." };
  }
  const type = input.type as WorkerCommandType;
  const payload = input.payload ?? {};
  if (!isPlainObject(payload)) return { ok: false as const, error: "Command details must be an object." };
  const blocked = Object.keys(payload).find((key) => BLOCKED_KEYS.includes(key.toLowerCase()));
  if (blocked) return { ok: false as const, error: "Command details cannot include shell or script text." };
  const parsed = payloadByType[type].safeParse(payload);
  if (!parsed.success) return { ok: false as const, error: "Command details are not valid." };
  if (type === "start_discovery") {
    const discovery = discoveryPayload.parse(parsed.data);
    if (discovery.mode === "review_target" && discovery.reviewTarget == null) {
      return { ok: false as const, error: "Choose how many prospects should sit in Review." };
    }
    if (discovery.mode === "duration" && discovery.durationMinutes == null) {
      return { ok: false as const, error: "Choose how long Discovery should run." };
    }
    if (discovery.mode === "inspection_count" && discovery.inspectionCount == null) {
      return { ok: false as const, error: "Choose how many profiles Discovery should inspect." };
    }
  }
  return { ok: true as const, type, payload: parsed.data };
}

export function claimAllowed(input: { commandWorkerId: string | null; requesterId: string; status: string }) {
  if (input.status !== "queued") return false;
  if (input.commandWorkerId && input.commandWorkerId !== input.requesterId) return false;
  return true;
}

export function sameActiveCommand(input: { existingStatus: string | null; idempotencyKey: string | null }) {
  if (!input.idempotencyKey) return false;
  return input.existingStatus === "queued" || input.existingStatus === "claimed" || input.existingStatus === "running";
}

export function commandExpired(input: { status: string; expiresAt: string | null; now: Date }) {
  if (input.status !== "queued" && input.status !== "claimed") return false;
  if (!input.expiresAt) return false;
  return new Date(input.expiresAt).getTime() <= input.now.getTime();
}

export function completedCommandCanRunAgain(status: string) {
  return status !== "completed" && status !== "running" && status !== "claimed";
}

export function discoveryRunShouldStop(input: {
  mode: "review_target" | "duration" | "inspection_count" | "continuous";
  startedAt: string | null;
  durationMinutes: number | null;
  inspectionLimit: number | null;
  inspections: number;
  now: Date;
}) {
  if (input.mode === "duration" && input.startedAt && input.durationMinutes) {
    const end = new Date(input.startedAt).getTime() + input.durationMinutes * 60_000;
    if (input.now.getTime() >= end) return { stop: true as const, reason: "duration_elapsed" };
  }
  if (input.mode === "inspection_count" && input.inspectionLimit != null && input.inspections >= input.inspectionLimit) {
    return { stop: true as const, reason: "inspection_count_reached" };
  }
  return { stop: false as const, reason: null };
}

export function commandIdempotencyKey(type: WorkerCommandType, payload: Record<string, unknown>) {
  if (type === "inspect_dm" || type === "inspect_composer") {
    return `${type}:${String(payload.username ?? "")}`;
  }
  if (type === "start_discovery") return `${type}:${JSON.stringify(payload)}`;
  return type;
}

export const COMMAND_LABELS: Record<WorkerCommandType, string> = {
  start_discovery: "Start Discovery",
  pause_discovery: "Pause Discovery",
  stop_discovery: "Stop Discovery",
  start_outreach: "Start Outreach",
  pause_outreach: "Pause Outreach",
  run_discovery_test: "Test Discovery — 10 Profiles",
  run_outreach_preview: "Preview Next Outreach",
  run_one_outreach: "Run One Outreach",
  recover_outreach: "Recover Interrupted Outreach",
  inspect_dm: "Test Instagram DM Detection",
  inspect_composer: "Test Message Composer",
  refresh_instagram_auth_check: "Check Instagram login",
  clear_worker_attention: "Clear attention",
  restart_browser_session_if_safe: "Restart Automation Browser",
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
