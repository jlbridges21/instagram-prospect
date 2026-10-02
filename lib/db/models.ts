import type { DateFormat, PreferredBrowser } from "@/lib/constants/settings";
import type { OutreachSettings } from "@/lib/outreach/types";

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
