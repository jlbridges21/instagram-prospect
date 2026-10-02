import { DEFAULT_OUTREACH_SETTINGS, outreachIdempotencyKey } from "../lib/outreach/defaults";
import { outreachBlockReason } from "../lib/outreach/eligibility";
import { expiredClaimResolution, isJobClaimable } from "../lib/outreach/claim-rules";
import { failurePlan, jobsCancelledAfter, verifyDecision, workerMayClaim } from "../lib/outreach/decisions";
import { jitterSeconds, nextSendInstant } from "../lib/outreach/scheduler";
import { zonedParts, zonedTimeToUtc } from "../lib/outreach/time";
import type { OutreachSettings } from "../lib/outreach/types";

const failures: string[] = [];

function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`ok ${name}`);
    return;
  }
  failures.push(name);
  console.log(`FAIL ${name}${detail ? `: ${detail}` : ""}`);
}

const targeting = { minFollowers: 500, maxFollowers: 250000 };
const baseProspect = {
  status: "review" as const,
  already_following: false,
  already_contacted: false,
  fit_label: "strong_fit" as const,
  follower_count: 5000,
  ai_analysis: null,
  outreach_cancelled_at: null,
};

check("eligible prospect has no block", outreachBlockReason(baseProspect, targeting) === null);
check(
  "already following is blocked",
  outreachBlockReason({ ...baseProspect, already_following: true }, targeting) === "already following",
);
check(
  "already contacted is blocked",
  outreachBlockReason({ ...baseProspect, already_contacted: true }, targeting) === "already contacted",
);
check(
  "skip label is blocked",
  outreachBlockReason({ ...baseProspect, fit_label: "skip" }, targeting) === "AI marked the prospect as skip",
);
check(
  "low followers are blocked",
  outreachBlockReason({ ...baseProspect, follower_count: 300 }, targeting)?.includes("below") === true,
);
check(
  "high followers are blocked",
  outreachBlockReason({ ...baseProspect, follower_count: 400000 }, targeting)?.includes("above") === true,
);
check(
  "unknown followers stay eligible",
  outreachBlockReason({ ...baseProspect, follower_count: null }, targeting) === null,
);

const prospectId = "11111111-1111-4111-8111-111111111111";
const firstKey = outreachIdempotencyKey(prospectId, "verify_profile");
check("idempotency key is stable", firstKey === outreachIdempotencyKey(prospectId, "verify_profile"));
check("job keys differ by type", firstKey !== outreachIdempotencyKey(prospectId, "send_message"));

check("verify continue", verifyDecision({ profileExists: true, alreadyFollowing: false }).outcome === "continue");
check(
  "verify existing follow cancels later jobs",
  verifyDecision({ profileExists: true, alreadyFollowing: true }).outcome === "existing_follow" &&
    jobsCancelledAfter("verify_profile").join() === "follow_profile,send_message",
);
check("missing profile cancels later jobs", verifyDecision({ profileExists: false, alreadyFollowing: false }).outcome === "missing");
check("follow failure cancels send", jobsCancelledAfter("follow_profile").join() === "send_message");

const firstFail = failurePlan({ attemptCount: 0, maxAttempts: 3, retryable: true });
const secondFail = failurePlan({ attemptCount: firstFail.attemptCount, maxAttempts: 3, retryable: true });
const thirdFail = failurePlan({ attemptCount: secondFail.attemptCount, maxAttempts: 3, retryable: true });
check("first failure waits 5 minutes", firstFail.status === "retry_wait" && firstFail.delayMinutes === 5);
check("second failure waits 15 minutes", secondFail.status === "retry_wait" && secondFail.delayMinutes === 15);
check("third failure is final", thirdFail.status === "failed" && thirdFail.delayMinutes === null);

const quiet: OutreachSettings = {
  ...DEFAULT_OUTREACH_SETTINGS,
  schedulingSpreadSeconds: 0,
  minimumActionDelaySeconds: 30,
  hourlyMaximum: 2,
  dailyMaximum: 150,
};
const zone = "America/Chicago";
const evening = zonedTimeToUtc({ year: 2026, month: 10, day: 2, hour: 20, minute: 0 }, zone);
const afterHours = nextSendInstant({
  now: evening,
  timeZone: zone,
  settings: quiet,
  occupied: [],
  seed: "after-hours",
});
const afterParts = zonedParts(afterHours, zone);
check(
  "outside active hours moves to the next window",
  afterParts.weekday === "sat" && afterParts.hour === 9 && afterParts.minute === 0,
  `${afterParts.weekday} ${afterParts.hour}:${afterParts.minute}`,
);

const ten = zonedTimeToUtc({ year: 2026, month: 10, day: 3, hour: 10, minute: 5 }, zone);
const occupied = [
  zonedTimeToUtc({ year: 2026, month: 10, day: 3, hour: 10, minute: 0 }, zone),
  zonedTimeToUtc({ year: 2026, month: 10, day: 3, hour: 10, minute: 1 }, zone),
];
const later = nextSendInstant({
  now: ten,
  timeZone: zone,
  settings: quiet,
  occupied,
  seed: "hourly",
});
const laterParts = zonedParts(later, zone);
check(
  "hourly maximum moves the next send to the following hour",
  laterParts.hour === 11 && laterParts.day === 3,
  `${laterParts.hour}:${laterParts.minute}`,
);

const dailySettings = { ...quiet, hourlyMaximum: 100, dailyMaximum: 2 };
const dailyFull = nextSendInstant({
  now: ten,
  timeZone: zone,
  settings: dailySettings,
  occupied,
  seed: "daily",
});
const dailyParts = zonedParts(dailyFull, zone);
check("daily maximum moves to the next active day", dailyParts.day === 4 && dailyParts.hour === 9, `${dailyParts.day} ${dailyParts.hour}`);

const spreadA = jitterSeconds("alpha", 360);
const spreadB = jitterSeconds("bravo", 360);
check("spread stays inside the configured range", spreadA <= 360 && spreadB <= 360);
check("different prospects do not share one offset", spreadA !== spreadB);

const now = new Date("2026-10-02T15:00:00.000Z");
check(
  "paused automation claims nothing",
  workerMayClaim({
    automationEnabled: false,
    workerEnabled: true,
    requesterId: "worker-a",
    maxActiveWorkers: 1,
    onlineWorkers: [{ id: "worker-a", startedAt: now.toISOString() }],
  }).reason === "automation_paused",
);
check(
  "the earlier worker keeps the only slot",
  workerMayClaim({
    automationEnabled: true,
    workerEnabled: true,
    requesterId: "worker-b",
    maxActiveWorkers: 1,
    onlineWorkers: [
      { id: "worker-a", startedAt: "2026-10-02T14:00:00.000Z" },
      { id: "worker-b", startedAt: "2026-10-02T14:05:00.000Z" },
    ],
  }).reason === "another_worker_active" &&
    workerMayClaim({
      automationEnabled: true,
      workerEnabled: true,
      requesterId: "worker-a",
      maxActiveWorkers: 1,
      onlineWorkers: [
        { id: "worker-a", startedAt: "2026-10-02T14:00:00.000Z" },
        { id: "worker-b", startedAt: "2026-10-02T14:05:00.000Z" },
      ],
    }).allowed === true,
);

check(
  "a due verify job is claimable",
  isJobClaimable(
    {
      status: "pending",
      availableAt: "2026-10-02T14:00:00.000Z",
      scheduledFor: "2026-10-02T14:00:00.000Z",
      dependsOnStatus: null,
      prospectStatus: "approved",
      outreachCancelled: false,
      alreadyFollowing: false,
      alreadyContacted: false,
      jobType: "verify_profile",
    },
    now,
  ),
);
check(
  "send waits for follow to complete",
  !isJobClaimable(
    {
      status: "pending",
      availableAt: "2026-10-02T14:00:00.000Z",
      scheduledFor: "2026-10-02T14:00:00.000Z",
      dependsOnStatus: "pending",
      prospectStatus: "approved",
      outreachCancelled: false,
      alreadyFollowing: false,
      alreadyContacted: false,
      jobType: "send_message",
    },
    now,
  ),
);
check(
  "an expired claim can be requeued",
  expiredClaimResolution({
    status: "claimed",
    claimExpiresAt: "2026-10-02T14:00:00.000Z",
    attemptCount: 0,
    maxAttempts: 3,
    now,
  }) === "requeue",
);
check(
  "an expired final claim fails",
  expiredClaimResolution({
    status: "running",
    claimExpiresAt: "2026-10-02T14:00:00.000Z",
    attemptCount: 2,
    maxAttempts: 3,
    now,
  }) === "fail",
);

console.log(failures.length === 0 ? "outreach checks passed" : `${failures.length} failed`);
if (failures.length > 0) process.exit(1);
