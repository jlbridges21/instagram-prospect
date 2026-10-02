import fs from "node:fs";
import { loadLocalEnv } from "./load-env";

loadLocalEnv();

async function main() {
  const major = Number(process.versions.node.split(".")[0]);
  if (!Number.isFinite(major) || major < 20) {
    console.error("Install Node.js 20 or newer.");
    process.exitCode = 1;
    return;
  }

  const baseUrl = process.env.OUTREACH_APP_URL?.trim().replace(/\/$/, "");
  const secret = process.env.WORKER_API_SECRET?.trim();
  if (!baseUrl || !secret) {
    console.error("Set OUTREACH_APP_URL and WORKER_API_SECRET in .env.local.");
    process.exitCode = 1;
    return;
  }

  const { browserProfileDir, logDir, screenshotDir } = await import("../worker/paths");
  const { loadIdentity } = await import("../worker/identity");

  for (const dir of [browserProfileDir(), logDir(), screenshotDir()]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const identity = loadIdentity();
  const response = await fetch(`${baseUrl}/api/worker/config`, {
    headers: { authorization: `Bearer ${secret}` },
    redirect: "manual",
  });

  console.log("ShootPortal Outreach setup");
  console.log("--------------------------");
  console.log(`Node: ${process.version}`);
  console.log(`Platform: ${process.platform}`);
  console.log(`Worker: ${identity.machine_name}`);
  console.log(`Worker ID: ${identity.worker_id}`);
  console.log(`Dashboard: ${baseUrl}`);
  console.log(`Browser profile: ${browserProfileDir()}`);
  console.log(`Logs: ${logDir()}`);

  if (!response.ok) {
    console.error(`Worker API authentication failed (${response.status}).`);
    process.exitCode = 1;
    return;
  }

  console.log("✓ Worker API authenticated");
  console.log("✓ Browser profile directory is ready");
  console.log("Next: npm run agent:login");
  console.log("Then: npm run agent");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Setup failed.");
  process.exitCode = 1;
});
