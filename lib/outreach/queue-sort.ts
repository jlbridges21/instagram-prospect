export type QueueTab = "upcoming" | "progress" | "failed" | "completed" | "cancelled" | "all";

export type SortableJob = {
  id: string;
  status: string;
  scheduled_for: string;
  available_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  failed_at?: string | null;
  cancelled_at?: string | null;
  updated_at?: string | null;
};

const TAB_STATUSES: Record<QueueTab, string[] | null> = {
  upcoming: ["pending", "retry_wait"],
  progress: ["claimed", "running"],
  failed: ["failed"],
  completed: ["completed"],
  cancelled: ["cancelled"],
  all: null,
};

export function statusesForTab(tab: QueueTab) {
  return TAB_STATUSES[tab];
}

export function compareQueueJobs(tab: QueueTab, left: SortableJob, right: SortableJob) {
  const leftAt = sortStamp(tab, left);
  const rightAt = sortStamp(tab, right);
  const direction = tab === "upcoming" ? leftAt - rightAt : rightAt - leftAt;
  if (direction !== 0) return direction;
  return left.id < right.id ? -1 : 1;
}

export function mergeTabJobs<T extends { id: string; status: string }>(current: T[], incoming: T[], statuses: string[]) {
  const incomingIds = new Set(incoming.map((job) => job.id));
  const kept = current.filter((job) => !statuses.includes(job.status) || incomingIds.has(job.id));
  const keptIds = new Set(kept.map((job) => job.id));
  return [...kept.map((job) => incoming.find((next) => next.id === job.id) ?? job), ...incoming.filter((job) => !keptIds.has(job.id))];
}

function sortStamp(tab: QueueTab, job: SortableJob) {
  if (tab === "completed") return time(job.completed_at);
  if (tab === "failed") return time(job.failed_at ?? job.updated_at);
  if (tab === "progress") return time(job.started_at ?? job.updated_at);
  if (tab === "cancelled") return time(job.cancelled_at ?? job.updated_at);
  if (tab === "upcoming") return time(job.available_at ?? job.scheduled_for);
  return time(job.updated_at ?? job.completed_at ?? job.failed_at ?? job.scheduled_for);
}

function time(value: string | null | undefined) {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}
