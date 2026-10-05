import fs from "node:fs";
import path from "node:path";
import { workerHome } from "../paths";

function file() {
  return path.join(workerHome(), "discovery-cadence.json");
}

export function readDiscoveryCadence(now = Date.now()) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file(), "utf8")) as { nextInspectionAt?: unknown; lastInspectionAt?: unknown };
    const next = typeof parsed.nextInspectionAt === "number" ? parsed.nextInspectionAt : now;
    const last = typeof parsed.lastInspectionAt === "number" ? parsed.lastInspectionAt : null;
    return { nextInspectionAt: next, lastInspectionAt: last };
  } catch {
    return { nextInspectionAt: now, lastInspectionAt: null as number | null };
  }
}

export function writeDiscoveryCadence(input: { nextInspectionAt: number; lastInspectionAt: number | null }) {
  const target = file();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(input));
  fs.renameSync(temp, target);
}
