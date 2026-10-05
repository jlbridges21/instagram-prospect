export type SeedEvent = "inspected" | "review" | "approved" | "contacted";

export type SeedCounters = {
  inspected: number;
  review: number;
  approved: number;
  contacted: number;
};

const REVIEW = new Set(["review", "approved", "contacted", "replied", "follow_up", "demo_booked", "converted"]);
const APPROVED = new Set(["approved", "contacted", "replied", "follow_up", "demo_booked", "converted"]);
const CONTACTED = new Set(["contacted", "replied", "follow_up", "demo_booked", "converted"]);

export function statusEvents(status: string): Array<Exclude<SeedEvent, "inspected">> {
  const events: Array<Exclude<SeedEvent, "inspected">> = [];
  if (REVIEW.has(status)) events.push("review");
  if (APPROVED.has(status)) events.push("approved");
  if (CONTACTED.has(status)) events.push("contacted");
  return events;
}

export function recordInspection(counters: SeedCounters, recorded: ReadonlySet<SeedEvent>) {
  if (recorded.has("inspected")) return { counters, recorded: new Set(recorded), applied: false };
  const nextRecorded = new Set(recorded);
  nextRecorded.add("inspected");
  return {
    counters: { ...counters, inspected: counters.inspected + 1 },
    recorded: nextRecorded,
    applied: true,
  };
}

export function syncStatus(counters: SeedCounters, recorded: ReadonlySet<SeedEvent>, status: string) {
  const next = { ...counters };
  const have = new Set(recorded);
  const want = new Set(statusEvents(status));
  for (const event of ["review", "approved", "contacted"] as const) {
    if (want.has(event) && !have.has(event)) {
      next[event] += 1;
      have.add(event);
    } else if (!want.has(event) && have.has(event)) {
      next[event] = Math.max(0, next[event] - 1);
      have.delete(event);
    }
  }
  return { counters: next, recorded: have };
}

export function releaseProspect(counters: SeedCounters, recorded: ReadonlySet<SeedEvent>): SeedCounters {
  const next = { ...counters };
  for (const event of recorded) next[event] = Math.max(0, next[event] - 1);
  return next;
}
