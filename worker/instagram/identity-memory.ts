import fs from "node:fs";
import path from "node:path";
import { workerHome } from "../paths";

type Memory = Record<string, string>;

function memoryPath() {
  return path.join(workerHome(), "dm-identity.json");
}

function readAll(): Memory {
  try {
    const parsed = JSON.parse(fs.readFileSync(memoryPath(), "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Memory;
  } catch {
    return {};
  }
}

export function readIdentityFingerprint(username: string) {
  const value = readAll()[username.replace(/^@/, "").toLowerCase()];
  return typeof value === "string" ? value : null;
}

export function writeIdentityFingerprint(username: string, fingerprint: string) {
  const all = readAll();
  all[username.replace(/^@/, "").toLowerCase()] = fingerprint;
  fs.mkdirSync(workerHome(), { recursive: true });
  fs.writeFileSync(memoryPath(), JSON.stringify(all));
}

export function clearIdentityFingerprint(username: string) {
  const all = readAll();
  delete all[username.replace(/^@/, "").toLowerCase()];
  fs.mkdirSync(workerHome(), { recursive: true });
  fs.writeFileSync(memoryPath(), JSON.stringify(all));
}
