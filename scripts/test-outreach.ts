import { DEFAULT_OUTREACH_SETTINGS, outreachIdempotencyKey } from "../lib/outreach/defaults";
import { outreachBlockReason } from "../lib/outreach/eligibility";
import { expiredClaimResolution, isJobClaimable } from "../lib/outreach/claim-rules";
import { failurePlan, jobsCancelledAfter, verifyDecision, workerMayClaim } from "../lib/outreach/decisions";
import { jitterSeconds, nextSendInstant } from "../lib/outreach/scheduler";
import { localDateKey, zonedParts, zonedTimeToUtc } from "../lib/outreach/time";
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
  "8:00 PM schedules immediately when pacing allows it",
  afterParts.weekday === "fri" && afterParts.hour === 20 && afterParts.minute === 0,
  `${afterParts.weekday} ${afterParts.hour}:${afterParts.minute}`,
);

const twoAm = zonedTimeToUtc({ year: 2026, month: 10, day: 3, hour: 2, minute: 0 }, zone);
const overnight = nextSendInstant({
  now: twoAm,
  timeZone: zone,
  settings: quiet,
  occupied: [],
  seed: "overnight",
});
const overnightParts = zonedParts(overnight, zone);
check(
  "2:00 AM may schedule an eligible send",
  overnightParts.day === 3 && overnightParts.hour === 2 && overnightParts.minute === 0,
  `${overnightParts.hour}:${overnightParts.minute}`,
);

const threePm = zonedTimeToUtc({ year: 2026, month: 10, day: 3, hour: 15, minute: 0 }, zone);
const afternoon = nextSendInstant({
  now: threePm,
  timeZone: zone,
  settings: quiet,
  occupied: [],
  seed: "afternoon",
});
const afternoonParts = zonedParts(afternoon, zone);
check(
  "3:00 PM schedules the same way",
  afternoonParts.day === 3 && afternoonParts.hour === 15 && afternoonParts.minute === 0,
  `${afternoonParts.hour}:${afternoonParts.minute}`,
);

const spacedFrom = zonedTimeToUtc({ year: 2026, month: 10, day: 3, hour: 2, minute: 0 }, zone);
const spacedNow = new Date(spacedFrom.getTime() + 10_000);
const spaced = nextSendInstant({
  now: spacedNow,
  timeZone: zone,
  settings: quiet,
  occupied: [spacedFrom],
  seed: "spacing",
});
check(
  "minimum spacing still delays the next send",
  spaced.getTime() === spacedFrom.getTime() + 30_000,
  String(spaced.getTime() - spacedFrom.getTime()),
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
check("daily maximum moves to the next local day", dailyParts.day === 4 && dailyParts.hour === 0 && dailyParts.minute === 0, `${dailyParts.day} ${dailyParts.hour}:${dailyParts.minute}`);

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

const claimAtTwo = zonedTimeToUtc({ year: 2026, month: 10, day: 3, hour: 2, minute: 0 }, zone);
const claimAtThree = zonedTimeToUtc({ year: 2026, month: 10, day: 3, hour: 15, minute: 0 }, zone);
const claimable = (at: Date) =>
  isJobClaimable(
    {
      status: "pending",
      availableAt: at.toISOString(),
      scheduledFor: at.toISOString(),
      dependsOnStatus: null,
      prospectStatus: "approved",
      outreachCancelled: false,
      alreadyFollowing: false,
      alreadyContacted: false,
      jobType: "verify_profile",
    },
    at,
  );
check("a due job at 2:00 AM is claimable", claimable(claimAtTwo));
check("a due job at 3:00 PM is claimable the same way", claimable(claimAtThree));

const beforeMidnight = new Date("2026-10-03T04:30:00.000Z");
const afterMidnight = new Date("2026-10-03T05:30:00.000Z");
check(
  "daily counters follow the settings timezone",
  localDateKey(beforeMidnight, zone) === "2026-10-2" && localDateKey(afterMidnight, zone) === "2026-10-3",
  `${localDateKey(beforeMidnight, zone)} / ${localDateKey(afterMidnight, zone)}`,
);

console.log(failures.length === 0 ? "outreach checks passed" : `${failures.length} failed`);
if (failures.length > 0) process.exit(1);
