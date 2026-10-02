import { loadLocalEnv } from "./load-env";

loadLocalEnv();

const args = process.argv.slice(2);
const loop = args.includes("--loop");
const alreadyFollowing = args.includes("--already-following");
const failType = args.find((arg) => arg.startsWith("--fail="))?.split("=")[1];

if (process.env.WORKER_SIMULATION_MODE !== "true") {
  console.error("Set WORKER_SIMULATION_MODE=true before running the simulator. The website does not simulate jobs on its own.");
  process.exit(1);
}

const base = process.env.OUTREACH_BASE_URL ?? "http://localhost:3000";
if (!base.includes("localhost") && !base.includes("127.0.0.1")) {
  console.error("The simulator only calls a local dashboard.");
  process.exit(1);
}

const secret = process.env.WORKER_API_SECRET;
if (!secret) {
  console.error("WORKER_API_SECRET is missing.");
  process.exit(1);
}

const workerId = "simulate-local";

async function post(path: string, body: unknown) {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    redirect: "manual",
  });
  const text = await response.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: response.status, json };
}

function resultFor(type: string) {
  if (type === "verify_profile") {
    return {
      profileExists: true,
      alreadyFollowing,
      username: "fictional.example",
    };
  }
  if (type === "follow_profile") return { followed: true };
  return { sent: true };
}

async function main() {
  const limit = loop ? 30 : 1;
  for (let index = 0; index < limit; index += 1) {
    const heartbeat = await post("/api/worker/heartbeat", {
      worker_id: workerId,
      machine_name: "Local simulator",
      platform: process.platform === "win32" ? "win32" : process.platform === "linux" ? "linux" : "darwin",
      status: "online",
      browser_connected: false,
      instagram_authenticated: false,
    });
    if (heartbeat.status !== 200) {
      console.error(`heartbeat ${heartbeat.status}`);
      process.exit(1);
    }

    const next = await post("/api/worker/jobs/next", { worker_id: workerId });
    if (next.status !== 200) {
      console.error(`next ${next.status}`);
      process.exit(1);
    }
    const payload = next.json as { job?: { id?: string; type?: string } | null; reason?: string | null };
    if (!payload.job?.id || !payload.job.type) {
      console.log(payload.reason ? `no job (${payload.reason})` : "no job");
      return;
    }

    console.log(`claimed ${payload.job.type} ${payload.job.id}`);
    const started = await post(`/api/worker/jobs/${payload.job.id}/start`, { worker_id: workerId });
    if (started.status !== 200) {
      console.error(`start ${started.status}`);
      process.exit(1);
    }

    if (failType && payload.job.type === failType) {
      const failed = await post(`/api/worker/jobs/${payload.job.id}/fail`, {
        worker_id: workerId,
        error_code: payload.job.type === "send_message" ? "message_send_failed" : "follow_failed",
        error_message: "Simulated failure",
        retryable: true,
      });
      console.log(`failed ${failed.status}`);
      if (failed.status !== 200) process.exit(1);
      continue;
    }

    const completed = await post(`/api/worker/jobs/${payload.job.id}/complete`, {
      worker_id: workerId,
      result: resultFor(payload.job.type),
    });
    console.log(`completed ${payload.job.type} ${completed.status}`);
    if (completed.status !== 200) process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Simulator failed.");
  process.exit(1);
});
