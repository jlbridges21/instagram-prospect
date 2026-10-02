import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { workerStatePath } from "./paths";

export type WorkerIdentity = {
  worker_id: string;
  machine_name: string;
  hostname: string;
  platform: string;
  created_at: string;
};

export function loadIdentity(): WorkerIdentity {
  const file = workerStatePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as WorkerIdentity;
    if (parsed.worker_id) return parsed;
  }
  const created: WorkerIdentity = {
    worker_id: crypto.randomUUID(),
    machine_name: process.env.WORKER_MACHINE_NAME?.trim() || os.hostname(),
    hostname: os.hostname(),
    platform: process.platform,
    created_at: new Date().toISOString(),
  };
  fs.writeFileSync(file, JSON.stringify(created, null, 2));
  return created;
}
