export const WORKER_PLATFORMS = ["darwin", "win32", "linux"] as const;

export type WorkerPlatform = (typeof WORKER_PLATFORMS)[number];

export type WorkerRuntimeStatus = "online" | "offline" | "error";

/**
 * Heartbeat the future local worker will write.
 * Paths stay relative to the project directory. Do not add user home folders.
 */
export type WorkerHeartbeat = {
  workerId: string;
  machineName: string;
  platform: WorkerPlatform;
  hostname: string;
  status: WorkerRuntimeStatus;
  currentTask: string | null;
  browserConnected: boolean;
  instagramAuthenticated: boolean;
  startedAt: string | null;
};
