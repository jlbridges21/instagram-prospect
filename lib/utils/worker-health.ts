export type WorkerHealthState = "online" | "stale" | "offline";

export function getWorkerHealth(input: {
  status: string | null;
  lastHeartbeatAt: string | null;
  heartbeatIntervalSeconds: number;
  now?: number;
}): { state: WorkerHealthState; label: string } {
  if (!input.lastHeartbeatAt) {
    return { state: "offline", label: "No worker connected" };
  }

  const heartbeat = new Date(input.lastHeartbeatAt).getTime();
  if (Number.isNaN(heartbeat)) {
    return { state: "offline", label: "No worker connected" };
  }

  const ageMs = (input.now ?? Date.now()) - heartbeat;
  const intervalMs = Math.max(input.heartbeatIntervalSeconds, 5) * 1000;

  const onlineWindowMs = intervalMs * 3;

  if (ageMs <= onlineWindowMs && input.status === "online") {
    return { state: "online", label: "Online" };
  }

  if (ageMs <= onlineWindowMs && input.status === "error") {
    return { state: "stale", label: "Error" };
  }

  return { state: "offline", label: "Offline" };
}
