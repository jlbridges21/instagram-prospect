import type { DiscoveryStrategy } from "@/lib/discovery/seeds";

export type CollectionSource = "seed" | "suggested_accounts" | "home_feed";
export type HomeFeedUsage = "low" | "medium" | "high";

export function pickCollectionSource(input: {
  hasSeeds: boolean;
  homeEnabled: boolean;
  suggestedEnabled: boolean;
  homeUsage: HomeFeedUsage;
  strategy: DiscoveryStrategy;
  random: number;
}) {
  const homeWeight = input.homeUsage === "high" ? 0.45 : input.homeUsage === "medium" ? 0.25 : 0.1;
  const seedShare = input.strategy === "conservative" ? 0.85 : input.strategy === "exploratory" ? 0.5 : 0.7;
  const roll = Math.min(0.999999, Math.max(0, input.random));
  if (input.homeEnabled && roll < homeWeight) return "home_feed" as const;
  const seedCutoff = homeWeight + (1 - homeWeight) * seedShare;
  if (input.hasSeeds && roll < seedCutoff) return "seed" as const;
  if (input.suggestedEnabled) return "suggested_accounts" as const;
  if (input.hasSeeds) return "seed" as const;
  return input.homeEnabled ? "home_feed" as const : "suggested_accounts" as const;
}
