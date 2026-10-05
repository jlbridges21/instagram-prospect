export type DiscoverySource = "home_feed" | "suggested_accounts" | "seed_suggestion";
export type CandidateState = "pending" | "in_progress" | "done" | "skipped";

export type DiscoveryCandidate = {
  username: string;
  profileUrl: string;
  source: DiscoverySource;
  sourcePostUrl: string | null;
  sourceThumbnailUrl: string | null;
  discoveredAt: string;
  sourceSeedId?: string | null;
  sourceSeedUsername?: string | null;
  priorityScore?: number;
  priorityLabel?: string;
  priorityReasons?: string[];
};

type QueueItem = {
  candidate: DiscoveryCandidate;
  state: CandidateState;
  tab: string | null;
};

export function normalizeCandidateUsername(value: string) {
  return value.trim().replace(/^@/, "").toLowerCase();
}

export class CandidateQueue {
  private items = new Map<string, QueueItem>();

  constructor(private target = 10) {}

  setTarget(target: number) {
    this.target = Math.max(1, target);
  }

  get queueTarget() {
    return this.target;
  }

  seen(username: string) {
    return this.items.has(normalizeCandidateUsername(username));
  }

  pendingCount() {
    return [...this.items.values()].filter((item) => item.state === "pending").length;
  }

  inProgress() {
    return [...this.items.values()]
      .filter((item) => item.state === "in_progress")
      .map((item) => ({ tab: item.tab, username: item.candidate.username }));
  }

  needsRefill() {
    return this.pendingCount() < this.target;
  }

  enqueue(candidate: DiscoveryCandidate) {
    const username = normalizeCandidateUsername(candidate.username);
    if (!username || this.items.has(username)) return "duplicate" as const;
    this.items.set(username, {
      candidate: { ...candidate, username },
      state: "pending",
      tab: null,
    });
    return "queued" as const;
  }

  claim(tabId: string) {
    let best: QueueItem | null = null;
    for (const item of this.items.values()) {
      if (item.state !== "pending") continue;
      if (!best || (item.candidate.priorityScore ?? 0) > (best.candidate.priorityScore ?? 0)) best = item;
    }
    if (!best) return null;
    best.state = "in_progress";
    best.tab = tabId;
    return best.candidate;
  }

  complete(username: string, state: "done" | "skipped" = "done") {
    const item = this.items.get(normalizeCandidateUsername(username));
    if (!item) return;
    item.state = state;
    item.tab = null;
  }

  fail(username: string) {
    this.complete(username, "skipped");
  }

  release(username: string) {
    const item = this.items.get(normalizeCandidateUsername(username));
    if (!item || item.state !== "in_progress") return;
    item.state = "pending";
    item.tab = null;
  }

  pendingCandidates() {
    return [...this.items.values()].filter((item) => item.state === "pending").map((item) => item.candidate);
  }

  seenUsernames() {
    return [...this.items.keys()];
  }
}

export class SessionUsernameCache {
  private checked = new Set<string>();
  private skipped = new Set<string>();

  has(username: string) {
    const key = normalizeCandidateUsername(username);
    return this.checked.has(key) || this.skipped.has(key);
  }

  remember(username: string, skip: boolean) {
    const key = normalizeCandidateUsername(username);
    this.checked.add(key);
    if (skip) this.skipped.add(key);
  }

  get skippedCount() {
    return this.skipped.size;
  }
}

export function unseenUsernames(usernames: string[], cache: SessionUsernameCache, queue: CandidateQueue) {
  const fresh: string[] = [];
  let skippedFromCache = 0;
  const seen = new Set<string>();
  for (const username of usernames) {
    const key = normalizeCandidateUsername(username);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (cache.has(key) || queue.seen(key)) {
      skippedFromCache += 1;
      continue;
    }
    fresh.push(key);
  }
  return { fresh, skippedFromCache };
}

export function chunkUsernames(usernames: string[], size = 15) {
  const chunks: string[][] = [];
  const limit = Math.min(25, Math.max(1, size));
  for (let index = 0; index < usernames.length; index += limit) {
    chunks.push(usernames.slice(index, index + limit));
  }
  return chunks;
}
