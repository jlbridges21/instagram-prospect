import fs from "node:fs";
import path from "node:path";
import { logDir } from "./paths";

type Level = "info" | "warn" | "error";

const SECRET_PATTERNS = [/bearer\s+\S+/gi, /WORKER_API_SECRET/gi, /sk-[a-z0-9]/gi];

export function log(level: Level, action: string, fields: Record<string, string | number | boolean | null> = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    action,
    ...fields,
  };
  const line = redact(JSON.stringify(entry));
  const prefix = level === "error" ? "error" : "log";
  console[prefix](line);
  try {
    fs.mkdirSync(logDir(), { recursive: true });
    const file = path.join(logDir(), `${entry.timestamp.slice(0, 10)}.log`);
    fs.appendFileSync(file, `${line}\n`);
  } catch {
    console.error("Could not write the local worker log.");
  }
}

export function redact(value: string) {
  return SECRET_PATTERNS.reduce((text, pattern) => text.replace(pattern, "[redacted]"), value);
}
