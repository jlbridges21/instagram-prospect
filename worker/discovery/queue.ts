import { censusFromScores, type PoolCensus } from "../../lib/discovery/pacing";

export type DiscoverySource = "home_feed" | "suggested_accounts" | "seed_suggestion" | "seed_network";
export type CandidateState = "pending" | "deferred" | "in_progress" | "done" | "skipped";

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
  cardText?: string | null;
  displayName?: string | null;
  sourcesSeen?: DiscoverySource[];
  seedSupport?: string[];
  inspectionSelection?: "ranked" | "exploration" | "starvation";
};

const DEFERRED_CAP = 30;

export function sourceStrength(source: DiscoverySource) {
  if (source === "seed_network" || source === "seed_suggestion") return 3;
  if (source === "suggested_accounts") return 2;
  return 1;
}

export function evidenceIsNew(existing: DiscoveryCandidate, incoming: DiscoveryCandidate) {
  if (sourceStrength(incoming.source) > sourceStrength(existing.source)) return true;
  const seed = incoming.sourceSeedUsername ? normalizeCandidateUsername(incoming.sourceSeedUsername) : "";
  const known = new Set([...(existing.seedSupport ?? []), existing.sourceSeedUsername ?? ""].map((value) => normalizeCandidateUsername(value)).filter(Boolean));
  if (seed && !known.has(seed)) return true;
  return (incoming.cardText?.trim().length ?? 0) > (existing.cardText?.trim().length ?? 0) + 20;
}

export function mergeCandidateEvidence(existing: DiscoveryCandidate, incoming: DiscoveryCandidate): DiscoveryCandidate {
  const sources = uniqueSources([...(existing.sourcesSeen ?? [existing.source]), incoming.source]);
  const support = uniqueNames([
    ...(existing.seedSupport ?? []),
    existing.sourceSeedUsername ?? "",
    incoming.sourceSeedUsername ?? "",
  ]);
  const incomingStronger = sourceStrength(incoming.source) > sourceStrength(existing.source);
  const cardText = longerText(existing.cardText, incoming.cardText);
  const discoveredAt = existing.discoveredAt <= incoming.discoveredAt ? existing.discoveredAt : incoming.discoveredAt;
  return {
    ...existing,
    source: incomingStronger ? incoming.source : existing.source,
    sourceSeedId: incomingStronger ? incoming.sourceSeedId ?? existing.sourceSeedId : existing.sourceSeedId,
    sourceSeedUsername: incomingStronger ? incoming.sourceSeedUsername ?? existing.sourceSeedUsername : existing.sourceSeedUsername,
    profileUrl: incomingStronger && incoming.profileUrl ? incoming.profileUrl : existing.profileUrl,
    sourcePostUrl: existing.sourcePostUrl ?? incoming.sourcePostUrl,
    cardText,
    displayName: existing.displayName || incoming.displayName || null,
    sourcesSeen: sources,
    seedSupport: support,
    discoveredAt,
  };
}

type QueueItem = {
  candidate: DiscoveryCandidate;
  state: CandidateState;
  tab: string | null;
  fromDeferred?: boolean;
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

  deferredCount() {
    return [...this.items.values()].filter((item) => item.state === "deferred").length;
  }

  census(floor: number, explorationFloor: number): PoolCensus {
    const scores = [...this.items.values()]
      .filter((item) => item.state === "pending" || item.state === "deferred")
      .map((item) => item.candidate.priorityScore ?? 0);
    return censusFromScores(scores, floor, explorationFloor);
  }

  hold(username: string) {
    const item = this.items.get(normalizeCandidateUsername(username));
    if (!item || (item.state !== "pending" && item.state !== "deferred")) return null;
    return item.candidate;
  }

  isClosed(username: string) {
    const item = this.items.get(normalizeCandidateUsername(username));
    return item?.state === "done" || item?.state === "skipped" || item?.state === "in_progress";
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

  place(candidate: DiscoveryCandidate, floor: number) {
    const username = normalizeCandidateUsername(candidate.username);
    if (!username) return "closed" as const;
    const stored = { ...candidate, username };
    const existing = this.items.get(username);
    if (existing && existing.state !== "pending" && existing.state !== "deferred") return "closed" as const;
    const score = stored.priorityScore ?? 0;
    if (existing) {
      existing.candidate = stored;
      if (existing.state === "deferred" && score >= floor && this.pendingCount() < this.target) existing.state = "pending";
      return "merged" as const;
    }
    if (score >= floor) {
      if (this.pendingCount() >= this.target) return "full" as const;
      this.items.set(username, { candidate: stored, state: "pending", tab: null });
      return "queued" as const;
    }
    this.keepDeferred(stored);
    return "deferred" as const;
  }

  claim(tabId: string, options?: { floor?: number; explore?: boolean; bestEligible?: boolean; explorationFloor?: number; random?: number }) {
    const floor = options?.floor ?? 0;
    const explore = options?.explore ?? false;
    const explorationFloor = options?.explorationFloor ?? 0;
    const ranked = this.best((item) => item.state === "pending" && (item.candidate.priorityScore ?? 0) >= floor);
    if (ranked) {
      ranked.state = "in_progress";
      ranked.tab = tabId;
      ranked.fromDeferred = false;
      ranked.candidate.inspectionSelection = "ranked";
      return ranked.candidate;
    }
    if (options?.bestEligible) {
      const best = this.best((item) => item.state === "deferred" && (item.candidate.priorityScore ?? 0) >= explorationFloor);
      if (!best) return null;
      best.state = "in_progress";
      best.tab = tabId;
      best.fromDeferred = true;
      best.candidate.inspectionSelection = "starvation";
      return best.candidate;
    }
    if (explore) {
      const picked = this.best((item) => item.state === "deferred" && (item.candidate.priorityScore ?? 0) >= explorationFloor);
      if (!picked) return null;
      picked.state = "in_progress";
      picked.tab = tabId;
      picked.fromDeferred = true;
      picked.candidate.inspectionSelection = "exploration";
      return picked.candidate;
    }
    return null;
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
    item.state = item.fromDeferred ? "deferred" : "pending";
    item.fromDeferred = false;
    item.tab = null;
  }

  pendingCandidates() {
    return [...this.items.values()].filter((item) => item.state === "pending").map((item) => item.candidate);
  }

  deferredCandidates() {
    return [...this.items.values()].filter((item) => item.state === "deferred").map((item) => item.candidate);
  }

  seenUsernames() {
    return [...this.items.keys()];
  }

  private best(include: (item: QueueItem) => boolean) {
    let best: QueueItem | null = null;
    for (const item of this.items.values()) {
      if (!include(item)) continue;
      if (!best || higherPriority(item, best)) best = item;
    }
    return best;
  }

  private keepDeferred(candidate: DiscoveryCandidate) {
    const deferred = [...this.items.values()].filter((item) => item.state === "deferred");
    if (deferred.length >= DEFERRED_CAP) {
      const lowest = deferred.reduce((worst, item) => (higherPriority(worst, item) ? item : worst));
      if ((lowest.candidate.priorityScore ?? 0) >= (candidate.priorityScore ?? 0)) return;
      this.items.delete(normalizeCandidateUsername(lowest.candidate.username));
    }
    this.items.set(candidate.username, { candidate, state: "deferred", tab: null });
  }
}

export class SessionUsernameCache {
  private seen = new Set<string>();

  has(username: string) {
    return this.seen.has(normalizeCandidateUsername(username));
  }

  remember(username: string, skip?: boolean) {
    if (skip === false) return;
    const key = normalizeCandidateUsername(username);
    if (key) this.seen.add(key);
  }

  forget(username: string) {
    this.seen.delete(normalizeCandidateUsername(username));
  }

  load(usernames: string[]) {
    for (const username of usernames) this.remember(username);
  }

  usernames() {
    return [...this.seen];
  }

  get skippedCount() {
    return this.seen.size;
  }
}

function uniqueNames(values: string[]) {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const value of values) {
    const name = normalizeCandidateUsername(value);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

function uniqueSources(values: DiscoverySource[]) {
  return [...new Set(values)];
}

function longerText(left: string | null | undefined, right: string | null | undefined) {
  const a = left?.trim() ?? "";
  const b = right?.trim() ?? "";
  if (!a) return b || null;
  if (!b) return a;
  return b.length > a.length ? b : a;
}

function higherPriority(item: QueueItem, best: QueueItem) {
  const score = item.candidate.priorityScore ?? 0;
  const bestScore = best.candidate.priorityScore ?? 0;
  if (score !== bestScore) return score > bestScore;
  return item.candidate.discoveredAt < best.candidate.discoveredAt;
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
