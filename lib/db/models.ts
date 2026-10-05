import type { DateFormat, PreferredBrowser } from "@/lib/constants/settings";
import type { DiscoveryTuning } from "@/lib/discovery/defaults";
import type { OutreachSettings } from "@/lib/outreach/types";

export type DiscoverySettings = {
  enabled: boolean;
  maxProfilesPerSession: number;
  maxProfilesPerHour: number;
  scrollDelaySeconds: number;
  duplicateCooldownDays: number;
  homeFeedEnabled: boolean;
  suggestedAccountsEnabled: boolean;
  sourcePriority: "suggested_first" | "home_first";
  candidateQueueTarget: number;
  profileInspectionConcurrency: number;
  reviewTarget: number | "unlimited";
  sessionInspectionCap: number;
  dailyInspectionCap: number;
  dailyAiCap: number;
  stopReason: string | null;
  autoPaused: boolean;
};

export type DiscoveryOptimization = {
  autoPromote: boolean;
  autoPromoteMinScore: number;
  promoteStrong: boolean;
  promotePossible: boolean;
  promoteRequires: "review" | "approved";
  minSeedSample: number;
  favorYield: boolean;
  yieldStrength: "low" | "medium" | "high";
  homeFeedUsage: "low" | "medium" | "high";
  strategy: "conservative" | "balanced" | "exploratory";
  seedCooldownCycles: number;
  positiveKeywords: string[];
  negativeKeywords: string[];
  tuning: DiscoveryTuning;
};

export type AppSettings = {
  messageTemplate: string;
  appName: string;
  timezone: string;
  dateFormat: DateFormat;
  workerEnabled: boolean;
  preferredBrowser: PreferredBrowser;
  heartbeatIntervalSeconds: number;
  maxActiveWorkers: number;
  aiEnabled: boolean;
  strongFitMinimum: number;
  possibleFitMinimum: number;
  outreach: OutreachSettings;
  discovery: DiscoverySettings;
  optimization: DiscoveryOptimization;
  updatedAt: string | null;
};

export type TargetingSettings = {
  categories: string[];
  minFollowers: number;
  maxFollowers: number;
  englishOnly: boolean;
  preferUnitedStates: boolean;
  allowUnknownLocation: boolean;
  excludeAlreadyFollowing: boolean;
  excludeAlreadyContacted: boolean;
  excludeHobbyAccounts: boolean;
  excludeMemeAccounts: boolean;
  excludeLargeAgencies: boolean;
  excludeUnrelatedDrone: boolean;
  updatedAt: string | null;
};

export type DataResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; missingTable: boolean };
