import os from "node:os";
import { browserProfileDir } from "./paths";
import type { WorkerPlatform } from "./types";

export type WorkerConfig = {
  platform: WorkerPlatform | string;
  hostname: string;
  machineName: string;
  browserProfileDir: string;
  heartbeatIntervalMs: number;
  maxActiveWorkers: number;
};

export function getWorkerConfig(
  overrides?: Partial<Pick<WorkerConfig, "heartbeatIntervalMs" | "maxActiveWorkers">>,
): WorkerConfig {
  return {
    platform: process.platform,
    hostname: os.hostname(),
    machineName: os.hostname(),
    browserProfileDir: browserProfileDir(),
    heartbeatIntervalMs: overrides?.heartbeatIntervalMs ?? 30_000,
    maxActiveWorkers: overrides?.maxActiveWorkers ?? 1,
  };
}
