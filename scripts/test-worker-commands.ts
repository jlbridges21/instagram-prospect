import assert from "node:assert/strict";
import {
  claimAllowed,
  commandExpired,
  commandIdempotencyKey,
  commandPriority,
  completedCommandCanRunAgain,
  discoveryRunShouldStop,
  parseWorkerCommand,
  sameActiveCommand,
} from "../lib/worker/commands";
import { executionEnabled, widgetState } from "../lib/worker/widget-state";
import { automationChange } from "../lib/outreach/requeue";

assert.equal(parseWorkerCommand({ type: "pause_discovery", payload: {} }).ok, true);
assert.equal(parseWorkerCommand({ type: "rm", payload: {} }).ok, false);
assert.equal(parseWorkerCommand({ type: "start_discovery", payload: { shell: "npm test" } }).ok, false);
assert.equal(parseWorkerCommand({ type: "start_discovery", payload: { mode: "review_target", reviewTarget: 20 } }).ok, true);
assert.equal(parseWorkerCommand({ type: "inspect_dm", payload: { username: "vsiaerial" } }).ok, true);
assert.equal(parseWorkerCommand({ type: "inspect_dm", payload: { username: "bad name" } }).ok, false);

assert.equal(claimAllowed({ commandWorkerId: null, requesterId: "a", status: "queued" }), true);
assert.equal(claimAllowed({ commandWorkerId: "b", requesterId: "a", status: "queued" }), false);
assert.equal(claimAllowed({ commandWorkerId: "a", requesterId: "a", status: "completed" }), false);
assert.equal(sameActiveCommand({ existingStatus: "queued", idempotencyKey: "start_discovery:{}" }), true);
assert.equal(sameActiveCommand({ existingStatus: "completed", idempotencyKey: "start_discovery:{}" }), false);
assert.equal(commandIdempotencyKey("start_discovery", { mode: "continuous" }), commandIdempotencyKey("start_discovery", { mode: "continuous" }));
assert.equal(commandIdempotencyKey("run_one_outreach", {}), "run_one_outreach");
assert.equal(commandPriority("pause_outreach") < commandPriority("start_discovery"), true);
assert.equal(commandExpired({ status: "queued", expiresAt: "2020-01-01T00:00:00.000Z", now: new Date("2026-01-01T00:00:00.000Z") }), true);
assert.equal(completedCommandCanRunAgain("completed"), false);
assert.equal(completedCommandCanRunAgain("expired"), true);

assert.equal(discoveryRunShouldStop({ mode: "continuous", startedAt: null, durationMinutes: null, inspectionLimit: null, inspections: 500, now: new Date() }).stop, false);
assert.equal(discoveryRunShouldStop({ mode: "inspection_count", startedAt: null, durationMinutes: null, inspectionLimit: 10, inspections: 10, now: new Date() }).reason, "inspection_count_reached");
assert.equal(discoveryRunShouldStop({ mode: "duration", startedAt: "2026-10-03T22:00:00.000Z", durationMinutes: 30, inspectionLimit: null, inspections: 1, now: new Date("2026-10-03T22:31:00.000Z") }).reason, "duration_elapsed");
assert.equal(discoveryRunShouldStop({ mode: "review_target", startedAt: null, durationMinutes: null, inspectionLimit: null, inspections: 100, now: new Date() }).stop, false);

assert.equal(widgetState({ online: false, attention: false, discoveryEnabled: true, outreachEnabled: false, hourlyWaiting: false, commandStatus: null, currentTask: null, error: false }).state, "offline");
assert.equal(widgetState({ online: true, attention: true, discoveryEnabled: true, outreachEnabled: false, hourlyWaiting: false, commandStatus: null, currentTask: "attention_required", error: false }).state, "attention");
assert.equal(widgetState({ online: true, attention: false, discoveryEnabled: true, outreachEnabled: false, hourlyWaiting: true, commandStatus: null, currentTask: "discovery_hourly_wait", error: false }).state, "discovery_waiting");
assert.equal(widgetState({ online: true, attention: false, discoveryEnabled: false, outreachEnabled: true, hourlyWaiting: false, commandStatus: null, currentTask: null, error: false }).state, "outreach");
assert.equal(widgetState({ online: true, attention: false, discoveryEnabled: false, outreachEnabled: false, hourlyWaiting: false, commandStatus: null, currentTask: "standby", error: false }).state, "ready");
assert.equal(executionEnabled(false), false);

const pause = automationChange(false, false);
assert.equal(pause.automationEnabled, false);
assert.equal(pause.cancelPendingJobs, false);

console.log("worker command tests passed");
