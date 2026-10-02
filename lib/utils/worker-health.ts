export type WorkerHealthState = "online" | "stale" | "offline" | "attention";

export function getWorkerHealth(input: {
  status: string | null;
  lastHeartbeatAt: string | null;
  heartbeatIntervalSeconds: number;
  currentTask?: string | null;
  attentionReason?: string | null;
  now?: number;
}): { state: WorkerHealthState; label: string } {
  if (!input.lastHeartbeatAt) {
    return { state: "offline", label: "Offline" };
  }

  const heartbeat = new Date(input.lastHeartbeatAt).getTime();
  if (Number.isNaN(heartbeat)) {
    return { state: "offline", label: "Offline" };
  }

  const ageMs = (input.now ?? Date.now()) - heartbeat;
  const intervalMs = Math.max(input.heartbeatIntervalSeconds, 5) * 1000;
  const onlineWindowMs = intervalMs * 3;
  if (ageMs > onlineWindowMs) return { state: "offline", label: "Offline" };

  if (input.status === "attention_required" || input.currentTask === "auth_required") {
    const login =
      input.currentTask === "auth_required" || /login/i.test(input.attentionReason ?? "");
    return {
      state: "attention",
      label: login ? "Authentication Required" : "Attention Required",
    };
  }

  if (input.status === "error") return { state: "stale", label: "Attention Required" };

  if (input.status === "online") {
    return { state: "online", label: taskLabel(input.currentTask) };
  }

  return { state: "offline", label: "Offline" };
}

function taskLabel(task: string | null | undefined) {
  if (!task || task === "idle") return task ? "Idle" : "Online";
  if (task === "paused") return "Paused";
  if (task.startsWith("discovering") || task.startsWith("qualifying") || task === "waiting_for_review") {
    return "Discovering";
  }
  if (task.startsWith("executing_")) return "Executing Outreach";
  return "Online";
}
