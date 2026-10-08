export type OrchestratorAction = "attention" | "outreach" | "discovery" | "sleep";

export type OrchestratorStep = {
  action: OrchestratorAction;
  sleepMs: number;
  discoveryYieldsToOutreach: boolean;
};

const MAX_IDLE_SLEEP_MS = 15_000;

export function nextOrchestratorStep(input: {
  now: number;
  attention: boolean;
  heartbeatDueAt: number;
  outreach: {
    desired: boolean;
    critical: boolean;
    eligibleNow: boolean;
    nextEligibleAt: number | null;
  };
  discovery: {
    desired: boolean;
    eligibleNow: boolean;
    nextEligibleAt: number | null;
    inspectionInProgress: boolean;
  };
}): OrchestratorStep {
  if (input.attention) {
    return { action: "attention", sleepMs: boundedWait(input.heartbeatDueAt, input.now), discoveryYieldsToOutreach: false };
  }
  if (input.outreach.desired && input.outreach.critical) {
    return { action: "outreach", sleepMs: 0, discoveryYieldsToOutreach: true };
  }
  if (input.outreach.desired && input.outreach.eligibleNow && !input.discovery.inspectionInProgress) {
    return { action: "outreach", sleepMs: 0, discoveryYieldsToOutreach: true };
  }
  if (input.discovery.desired && input.discovery.eligibleNow && !input.outreach.critical) {
    return { action: "discovery", sleepMs: 0, discoveryYieldsToOutreach: false };
  }
  if (
    input.discovery.desired &&
    input.discovery.nextEligibleAt != null &&
    input.discovery.nextEligibleAt <= input.now
  ) {
    return { action: "sleep", sleepMs: 0, discoveryYieldsToOutreach: false };
  }
  return {
    action: "sleep",
    sleepMs: boundedWait(earliestWake(input), input.now),
    discoveryYieldsToOutreach: false,
  };
}

export function discoveryShouldYield(input: {
  hourlyFull: boolean;
  outreachDueNow: boolean;
  inspectionInProgress: boolean;
}) {
  if (input.hourlyFull) return { yield: true, finishCurrentInspection: input.inspectionInProgress };
  if (input.outreachDueNow && input.inspectionInProgress) return { yield: true, finishCurrentInspection: true };
  if (input.outreachDueNow) return { yield: true, finishCurrentInspection: false };
  return { yield: false, finishCurrentInspection: false };
}

export function browserLeaseAllowsForceRelease(input: {
  phase: "click" | "verify" | "idle";
  heldMs: number;
  maxVerifyMs: number;
}) {
  if (input.phase === "click") return false;
  return input.phase === "verify" && input.heldMs >= input.maxVerifyMs;
}

export function releaseAfterUncertainFollow(input: {
  persisted: boolean;
  releaseLock: () => void;
  clearSideEffect: () => void;
}) {
  if (!input.persisted) return { released: false as const };
  input.clearSideEffect();
  input.releaseLock();
  return { released: true as const };
}

export class BrowserActionLock {
  private owner: "outreach" | "discovery" | null = null;
  private critical = false;
  private acquiredAt: number | null = null;
  private phase: "click" | "verify" | "idle" = "idle";

  heldBy() {
    return this.owner;
  }

  isCritical() {
    return this.critical;
  }

  setPhase(phase: "click" | "verify" | "idle") {
    this.phase = phase;
  }

  holdMs(now = Date.now()) {
    if (this.acquiredAt == null) return 0;
    return Math.max(0, now - this.acquiredAt);
  }

  tryAcquire(owner: "outreach" | "discovery", critical = false) {
    if (this.owner && this.owner !== owner) return false;
    if (this.critical && owner !== "outreach") return false;
    if (this.owner !== owner || this.acquiredAt == null) this.acquiredAt = Date.now();
    this.owner = owner;
    this.critical = critical || this.critical;
    if (critical) this.phase = "click";
    return true;
  }

  release(owner: "outreach" | "discovery") {
    if (this.owner !== owner) return;
    this.owner = null;
    this.critical = false;
    this.acquiredAt = null;
    this.phase = "idle";
  }
}

export function earliestWake(input: {
  now: number;
  heartbeatDueAt: number;
  outreach: { nextEligibleAt: number | null };
  discovery: { nextEligibleAt: number | null };
}) {
  const times = [input.heartbeatDueAt, input.outreach.nextEligibleAt, input.discovery.nextEligibleAt].filter(
    (value): value is number => value != null && Number.isFinite(value),
  );
  if (times.length === 0) return input.now + MAX_IDLE_SLEEP_MS;
  return Math.min(...times);
}

function boundedWait(wakeAt: number, now: number) {
  return Math.max(1_000, Math.min(MAX_IDLE_SLEEP_MS, wakeAt - now));
}
