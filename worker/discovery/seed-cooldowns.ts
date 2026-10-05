import fs from "node:fs";
import path from "node:path";
import { emptySeedCooldownUntil } from "../instagram/seed-page";
import { normalizeInstagramUsername } from "../instagram/profile-href";
import { workerHome } from "../paths";

type CooldownFile = Record<string, string>;

export function seedReadCooldownPath() {
  return path.join(workerHome(), "seed-read-cooldowns.json");
}

export function readEmptySeedCooldowns(now = Date.now(), filePath = seedReadCooldownPath()) {
  let parsed: CooldownFile = {};
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as CooldownFile;
  } catch {
    parsed = {};
  }
  const active: Record<string, string> = {};
  for (const [username, until] of Object.entries(parsed)) {
    if (typeof until !== "string") continue;
    if (new Date(until).getTime() <= now) continue;
    active[normalizeInstagramUsername(username)] = until;
  }
  return active;
}

function writeCooldowns(pauses: CooldownFile, filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(pauses, null, 2));
}

export function rememberEmptySeed(username: string, now = Date.now(), filePath = seedReadCooldownPath()) {
  const pauses = readEmptySeedCooldowns(0, filePath);
  const key = normalizeInstagramUsername(username);
  pauses[key] = emptySeedCooldownUntil(now);
  const kept: CooldownFile = {};
  for (const [name, until] of Object.entries(pauses)) {
    if (new Date(until).getTime() > now) kept[name] = until;
  }
  writeCooldowns(kept, filePath);
  return kept[key] ?? "";
}

export function clearEmptySeed(username: string, now = Date.now(), filePath = seedReadCooldownPath()) {
  const pauses = readEmptySeedCooldowns(0, filePath);
  delete pauses[normalizeInstagramUsername(username)];
  const kept: CooldownFile = {};
  for (const [name, until] of Object.entries(pauses)) {
    if (new Date(until).getTime() > now) kept[name] = until;
  }
  writeCooldowns(kept, filePath);
}
