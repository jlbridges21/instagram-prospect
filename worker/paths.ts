import os from "node:os";
import path from "node:path";

export function workerHome() {
  const override = process.env.WORKER_STATE_DIR?.trim();
  if (override) return override;
  return path.join(os.homedir(), "ShootPortal-Outreach");
}

export function browserProfileDir() {
  return path.join(workerHome(), "browser-profile");
}

export function workerStatePath() {
  return path.join(workerHome(), "worker.json");
}

export function logDir() {
  return path.join(workerHome(), "logs");
}

export function screenshotDir() {
  return path.join(logDir(), "screenshots");
}

export function debugDir() {
  return path.join(logDir(), "debug");
}

export function pendingResultsPath() {
  return path.join(workerHome(), "pending-results.json");
}

export function discoveryQueuePath() {
  return path.join(workerHome(), "discovery-queue.json");
}

export function discoveryHourlyPath() {
  return path.join(workerHome(), "discovery-hourly.json");
}
