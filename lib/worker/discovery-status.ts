export type DiscoveryStatusView = {
  source: string;
  pending: string;
  tab1: string;
  tab2: string;
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
  };
}

export function formatDiscoveryStatus(input: {
  source: string;
  pending: number;
  tab1: string | null;
  tab2: string | null;
}) {
  const tab = (username: string | null) => (username ? `@${username}` : "idle");
  return `Discovery V2 | source=${input.source} | pending=${input.pending} | tab1=${tab(input.tab1)} | tab2=${tab(input.tab2)}`;
}
