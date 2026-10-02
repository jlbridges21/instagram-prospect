import fs from "node:fs";
import { loadLocalEnv } from "./load-env";

loadLocalEnv();

async function main() {
  const { workerStatePath } = await import("../worker/paths");
  const baseUrl = process.env.OUTREACH_APP_URL?.trim().replace(/\/$/, "");
  const secret = process.env.WORKER_API_SECRET?.trim();
  const statePath = workerStatePath();

  console.log("ShootPortal Outreach status");
  console.log("---------------------------");
  console.log(`Platform: ${process.platform}`);
  console.log(`Dashboard: ${baseUrl || "OUTREACH_APP_URL is not set"}`);

  if (fs.existsSync(statePath)) {
    const identity = JSON.parse(fs.readFileSync(statePath, "utf8")) as {
      worker_id?: string;
      machine_name?: string;
    };
    console.log(`Worker: ${identity.machine_name || "unknown"}`);
    console.log(`Worker ID: ${identity.worker_id || "missing"}`);
  } else {
    console.log("Worker ID: not created yet. Run npm run agent:setup.");
  }

  if (!baseUrl || !secret) {
    console.error("Set OUTREACH_APP_URL and WORKER_API_SECRET in .env.local.");
    process.exitCode = 1;
    return;
  }

  const response = await fetch(`${baseUrl}/api/worker/config`, {
    headers: { authorization: `Bearer ${secret}` },
    redirect: "manual",
  });
  if (!response.ok) {
    console.error(`Worker API: not authenticated (${response.status}).`);
    process.exitCode = 1;
    return;
  }
  const config = (await response.json()) as { discoveryEnabled?: boolean; automationEnabled?: boolean };
  console.log("Worker API: connected");
  console.log(`Discovery: ${config.discoveryEnabled === false ? "OFF" : "ON"}`);
  console.log(`Outreach: ${config.automationEnabled ? "RUNNING" : "PAUSED"}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Status check failed.");
  process.exitCode = 1;
});
