import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  claimAfterHeartbeat,
  createHeartbeatSession,
  mustHeartbeatBeforeClaim,
  safeHeartbeatError,
} from "../worker/heartbeat-session";

async function main() {
const events: string[] = [];
const session = createHeartbeatSession(60_000, async () => {
  events.push("heartbeat");
});

const claimed = await claimAfterHeartbeat({
  workerId: "worker-a",
  heartbeat: async (workerId) => {
    events.push(`heartbeat:${workerId}`);
    await session.register();
  },
  claim: async (workerId) => {
    events.push(`jobs/next:${workerId}`);
    return { username: "vsiaerial" };
  },
});

assert.equal(claimed.ok, true);
assert.deepEqual(events, ["heartbeat:worker-a", "heartbeat", "jobs/next:worker-a"]);
assert.equal(session.hasInterval(), true);

const intervalsBefore = session.hasInterval();
await session.register();
assert.equal(session.hasInterval(), intervalsBefore);
session.stop();
assert.equal(session.hasInterval(), false);

let claimCalls = 0;
const failed = await claimAfterHeartbeat({
  workerId: "worker-a",
  heartbeat: async () => {
    throw new Error("Cloud heartbeat returned 500.");
  },
  claim: async () => {
    claimCalls += 1;
  },
});
assert.equal(failed.ok, false);
assert.equal(claimCalls, 0);
if (!failed.ok) assert.match(safeHeartbeatError(failed.error), /500/);

assert.equal(
  mustHeartbeatBeforeClaim({
    mode: "agent",
    dryRun: false,
    singleOutreach: true,
    discoveryOnly: false,
    noWrite: false,
  }),
  true,
);
assert.equal(
  mustHeartbeatBeforeClaim({
    mode: "agent",
    dryRun: false,
    singleOutreach: false,
    discoveryOnly: false,
    noWrite: false,
  }),
  true,
);
assert.equal(
  mustHeartbeatBeforeClaim({
    mode: "agent",
    dryRun: false,
    singleOutreach: false,
    discoveryOnly: true,
    noWrite: false,
  }),
  false,
);

const source = readFileSync("worker/run.ts", "utf8");
const registerAt = source.indexOf("await heartbeats.register()");
const singleAt = source.indexOf("await runSingleOutreach(");
const jobAt = source.indexOf("await runOneJob(");
assert.ok(registerAt > 0);
assert.ok(registerAt < singleAt);
assert.ok(registerAt < jobAt);
const sessionSource = readFileSync("worker/heartbeat-session.ts", "utf8");
assert.equal(sessionSource.split("setInterval(").length - 1, 1);
assert.match(sessionSource, /if \(timer\) return/);
assert.match(source, /worker_id: identity\.worker_id/);
assert.match(source, /cloud\.nextJob\(identity\.worker_id/);

let timers = 0;
const original = globalThis.setInterval;
globalThis.setInterval = ((handler: TimerHandler, timeout?: number) => {
  timers += 1;
  return original(handler, timeout);
}) as typeof setInterval;
try {
  const once = createHeartbeatSession(60_000, async () => undefined);
  once.startInterval();
  once.startInterval();
  await once.register();
  assert.equal(timers, 1);
  assert.equal(once.hasInterval(), true);
  once.stop();
} finally {
  globalThis.setInterval = original;
}

console.log("heartbeat startup tests passed");
}

main();
