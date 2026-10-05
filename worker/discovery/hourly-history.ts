import fs from "node:fs";
import path from "node:path";
import { getDiscoveryHourlyState } from "../../lib/discovery/pacing";
import { discoveryHourlyPath } from "../paths";

export function readHourlyStamps(now = Date.now()) {
  try {
    const parsed = JSON.parse(fs.readFileSync(discoveryHourlyPath(), "utf8")) as { stamps?: unknown };
    const stamps = Array.isArray(parsed.stamps) ? parsed.stamps.filter((stamp): stamp is number => typeof stamp === "number") : [];
    return getDiscoveryHourlyState({ stamps, now, limit: Number.MAX_SAFE_INTEGER }).stamps;
  } catch {
    return [];
  }
}

export function writeHourlyStamps(stamps: number[]) {
  const file = discoveryHourlyPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify({ stamps }));
  fs.renameSync(temp, file);
}
