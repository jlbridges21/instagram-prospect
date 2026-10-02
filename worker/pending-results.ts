import fs from "node:fs";
import path from "node:path";
import { pendingResultsPath } from "./paths";

export type PendingResult = {
  jobId: string;
  workerId: string;
  kind: "complete" | "fail";
  body: Record<string, unknown>;
  createdAt: string;
};

export function readPending(): PendingResult[] {
  const file = pendingResultsPath();
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as PendingResult[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writePending(results: PendingResult[]) {
  const file = pendingResultsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(results, null, 2));
}

export function rememberPending(result: PendingResult) {
  const current = readPending().filter((item) => item.jobId !== result.jobId);
  current.push(result);
  writePending(current);
}

export function forgetPending(jobId: string) {
  writePending(readPending().filter((item) => item.jobId !== jobId));
}
