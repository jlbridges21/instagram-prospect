const CLOSED_STATUSES = new Set([
  "contacted",
  "replied",
  "follow_up",
  "demo_booked",
  "converted",
  "skipped",
  "disqualified",
  "approved",
  "qualified",
  "review",
]);

export function shouldSkipKnownProspect(input: {
  exists: boolean;
  status: string | null;
  alreadyFollowing: boolean;
  alreadyContacted: boolean;
  discoveredAt: string | null;
  analyzed: boolean;
  cooldownDays: number;
  now?: number;
}) {
  if (!input.exists) return false;
  if (input.alreadyFollowing || input.alreadyContacted) return true;
  if (input.status && CLOSED_STATUSES.has(input.status)) return true;
  if (!input.analyzed || !input.discoveredAt) return false;
  const discovered = new Date(input.discoveredAt).getTime();
  if (Number.isNaN(discovered)) return false;
  const ageMs = (input.now ?? Date.now()) - discovered;
  return ageMs < input.cooldownDays * 24 * 60 * 60 * 1000;
}
