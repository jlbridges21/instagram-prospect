import fs from "node:fs";
import path from "node:path";
import { EMPTY_SEED_COOLDOWN_MS, emptySeedCooldownUntil } from "../instagram/seed-page";
import { normalizeInstagramUsername } from "../instagram/profile-href";
import { workerHome } from "../paths";

type ExhaustionEntry = { until: string; emptyVisits: number };
type CooldownFile = Record<string, string | ExhaustionEntry>;

export function seedReadCooldownPath() {
  return path.join(workerHome(), "seed-read-cooldowns.json");
}

export function seedExhaustionMinutes(emptyVisits: number, durations = { first: 45, second: 120, third: 360 }) {
  if (emptyVisits >= 3) return durations.third;
  if (emptyVisits >= 2) return durations.second;
  return durations.first;
}

export function readSeedExhaustion(filePath = seedReadCooldownPath()) {
  let parsed: CooldownFile = {};
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as CooldownFile;
  } catch {
    parsed = {};
  }
  const entries: Record<string, ExhaustionEntry> = {};
  for (const [username, value] of Object.entries(parsed)) {
    const entry = parseEntry(value);
    if (!entry) continue;
    entries[normalizeInstagramUsername(username)] = entry;
  }
  return entries;
}

export function readEmptySeedCooldowns(now = Date.now(), filePath = seedReadCooldownPath()) {
  const active: Record<string, string> = {};
  for (const [username, entry] of Object.entries(readSeedExhaustion(filePath))) {
    if (new Date(entry.until).getTime() <= now) continue;
    active[username] = entry.until;
  }
  return active;
}

export function rememberEmptySeed(username: string, now = Date.now(), filePath = seedReadCooldownPath(), durationMs?: number) {
  const entries = readSeedExhaustion(filePath);
  const key = normalizeInstagramUsername(username);
  const previous = entries[key];
  entries[key] = {
    until: emptySeedCooldownUntil(now, durationMs),
    emptyVisits: previous?.emptyVisits ?? 1,
  };
  writeEntries(entries, filePath);
  return entries[key]?.until ?? "";
}

export function recordUnproductiveSeed(
  username: string,
  now = Date.now(),
  filePath = seedReadCooldownPath(),
  durations = { first: 45, second: 120, third: 360 },
) {
  const entries = readSeedExhaustion(filePath);
  const key = normalizeInstagramUsername(username);
  const emptyVisits = (entries[key]?.emptyVisits ?? 0) + 1;
  const minutes = seedExhaustionMinutes(emptyVisits, durations);
  entries[key] = { until: emptySeedCooldownUntil(now, minutes * 60 * 1000), emptyVisits };
  writeEntries(entries, filePath);
  return { emptyVisits, minutes, until: entries[key]?.until ?? "" };
}

export function clearEmptySeed(username: string, _now = Date.now(), filePath = seedReadCooldownPath()) {
  const entries = readSeedExhaustion(filePath);
  delete entries[normalizeInstagramUsername(username)];
  writeEntries(entries, filePath);
}

function parseEntry(value: unknown): ExhaustionEntry | null {
  if (typeof value === "string") return { until: value, emptyVisits: 1 };
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const until = (value as { until?: unknown }).until;
  const emptyVisits = (value as { emptyVisits?: unknown }).emptyVisits;
  if (typeof until !== "string") return null;
  const visits = typeof emptyVisits === "number" && Number.isFinite(emptyVisits) ? Math.max(1, Math.round(emptyVisits)) : 1;
  return { until, emptyVisits: visits };
}

function writeEntries(entries: Record<string, ExhaustionEntry>, filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(entries, null, 2));
}

export const DEFAULT_EMPTY_COOLDOWN_MS = EMPTY_SEED_COOLDOWN_MS;
