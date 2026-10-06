export type DiscoveryPoolView = {
  total: number;
  ranked: number;
  explorationEligible: number;
  deferred: number;
  highest: number | null;
};

export type DiscoveryStatusView = {
  source: string;
  pending: string;
  tab1: string;
  tab2: string;
  hour: string | null;
  pool: DiscoveryPoolView | null;
};

export function parseDiscoveryStatus(lastEvent: string | null | undefined): DiscoveryStatusView | null {
  if (!lastEvent?.startsWith("Discovery V2 |")) return null;
  const parts = Object.fromEntries(
    lastEvent
      .split("|")
      .slice(1)
      .map((part) => part.trim().split("="))
      .filter((pair) => pair.length === 2)
      .map(([key, value]) => [key, value]),
  );
  if (!parts.source) return null;
  return {
    source: parts.source,
    pending: parts.pending ?? "0",
    tab1: parts.tab1 ?? "idle",
    tab2: parts.tab2 ?? "idle",
    hour: parts.hour ?? null,
    pool: parsePool(parts.pool, parts.top),
  };
}

function parsePool(pool: string | undefined, top: string | undefined): DiscoveryPoolView | null {
  if (!pool) return null;
  const [total, ranked, explorationEligible, deferred] = pool.split("/").map((part) => Number(part));
  if (![total, ranked, explorationEligible, deferred].every((value) => Number.isFinite(value))) return null;
  const highest = top == null || top === "" || top === "none" ? null : Number(top);
  return {
    total,
    ranked,
    explorationEligible,
    deferred,
    highest: highest != null && Number.isFinite(highest) ? highest : null,
  };
}

export function formatDiscoveryStatus(input: {
  source: string;
  pending: number;
  tab1: string | null;
  tab2: string | null;
  hour?: string | null;
  pool?: { total: number; ranked: number; explorationEligible: number; deferred: number; highest: number | null } | null;
}) {
  const tab = (username: string | null) => (username ? `@${username}` : "idle");
  const hour = input.hour ? ` | hour=${input.hour}` : "";
  const pool = input.pool
    ? ` | pool=${input.pool.total}/${input.pool.ranked}/${input.pool.explorationEligible}/${input.pool.deferred} | top=${input.pool.highest ?? "none"}`
    : "";
  return `Discovery V2 | source=${input.source} | pending=${input.pending} | tab1=${tab(input.tab1)} | tab2=${tab(input.tab2)}${hour}${pool}`;
}
