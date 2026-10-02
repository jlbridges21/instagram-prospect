import "server-only";

import { cache } from "react";
import {
  DEFAULT_APP_NAME,
  DEFAULT_DATE_FORMAT,
  DEFAULT_HEARTBEAT_SECONDS,
  DEFAULT_TIMEZONE,
  isDateFormat,
  isPreferredBrowser,
} from "@/lib/constants/settings";
import { DEFAULT_CATEGORIES } from "@/lib/constants/settings";
import {
  DEFAULT_POSSIBLE_FIT_MINIMUM,
  DEFAULT_STRONG_FIT_MINIMUM,
} from "@/lib/ai/config";
import { DEFAULT_MESSAGE_TEMPLATE } from "@/lib/constants/message";
import { DEFAULT_OUTREACH_SETTINGS, normalizeClock, normalizeDays } from "@/lib/outreach/defaults";
import type { OutreachSettings } from "@/lib/outreach/types";
import { databaseErrorMessage, isMissingRelation } from "@/lib/db/errors";
import type { AppSettings, DataResult, TargetingSettings } from "@/lib/db/models";
import type { SettingsRow, TargetingSettingsRow } from "@/lib/db/types";
import { createClient } from "@/lib/supabase/server";

export type { AppSettings, DataResult, TargetingSettings };

function outreachFromRow(row: SettingsRow): OutreachSettings {
  return {
    automationEnabled: row.automation_enabled ?? DEFAULT_OUTREACH_SETTINGS.automationEnabled,
    activeDays: normalizeDays(row.active_days),
    activeStart: normalizeClock(row.active_start_time, DEFAULT_OUTREACH_SETTINGS.activeStart),
    activeEnd: normalizeClock(row.active_end_time, DEFAULT_OUTREACH_SETTINGS.activeEnd),
    hourlyMinimum: row.hourly_minimum ?? DEFAULT_OUTREACH_SETTINGS.hourlyMinimum,
    hourlyMaximum: row.hourly_maximum ?? DEFAULT_OUTREACH_SETTINGS.hourlyMaximum,
    dailyMaximum: row.daily_maximum ?? DEFAULT_OUTREACH_SETTINGS.dailyMaximum,
    minimumActionDelaySeconds:
      row.minimum_action_delay_seconds ?? DEFAULT_OUTREACH_SETTINGS.minimumActionDelaySeconds,
    schedulingSpreadSeconds:
      row.scheduling_spread_seconds ?? DEFAULT_OUTREACH_SETTINGS.schedulingSpreadSeconds,
    claimLeaseSeconds: row.job_claim_lease_seconds ?? DEFAULT_OUTREACH_SETTINGS.claimLeaseSeconds,
  };
}

export function appSettingsFromRow(row: SettingsRow): AppSettings {
  return {
    messageTemplate: row.message_template,
    appName: row.app_name,
    timezone: row.timezone || DEFAULT_TIMEZONE,
    dateFormat: isDateFormat(row.date_format) ? row.date_format : DEFAULT_DATE_FORMAT,
    workerEnabled: row.worker_enabled,
    preferredBrowser: isPreferredBrowser(row.preferred_browser)
      ? row.preferred_browser
      : "chromium",
    heartbeatIntervalSeconds: row.heartbeat_interval_seconds,
    maxActiveWorkers: row.max_active_workers,
    aiEnabled: row.ai_enabled ?? true,
    strongFitMinimum: row.strong_fit_minimum ?? DEFAULT_STRONG_FIT_MINIMUM,
    possibleFitMinimum: row.possible_fit_minimum ?? DEFAULT_POSSIBLE_FIT_MINIMUM,
    outreach: outreachFromRow(row),
    updatedAt: row.updated_at,
  };
}

function targetingFromRow(row: TargetingSettingsRow): TargetingSettings {
  return {
    categories: row.categories ?? [],
    minFollowers: row.min_followers,
    maxFollowers: row.max_followers,
    englishOnly: row.english_only,
    preferUnitedStates: row.prefer_united_states,
    allowUnknownLocation: row.allow_unknown_location,
    excludeAlreadyFollowing: row.exclude_already_following,
    excludeAlreadyContacted: row.exclude_already_contacted,
    excludeHobbyAccounts: row.exclude_hobby_accounts,
    excludeMemeAccounts: row.exclude_meme_accounts,
    excludeLargeAgencies: row.exclude_large_agencies,
    excludeUnrelatedDrone: row.exclude_unrelated_drone ?? true,
    updatedAt: row.updated_at,
  };
}

export function fallbackSettings(): AppSettings {
  return {
    messageTemplate: DEFAULT_MESSAGE_TEMPLATE,
    appName: DEFAULT_APP_NAME,
    timezone: DEFAULT_TIMEZONE,
    dateFormat: DEFAULT_DATE_FORMAT,
    workerEnabled: false,
    preferredBrowser: "chromium",
    heartbeatIntervalSeconds: DEFAULT_HEARTBEAT_SECONDS,
    maxActiveWorkers: 1,
    aiEnabled: true,
    strongFitMinimum: DEFAULT_STRONG_FIT_MINIMUM,
    possibleFitMinimum: DEFAULT_POSSIBLE_FIT_MINIMUM,
    outreach: DEFAULT_OUTREACH_SETTINGS,
    updatedAt: null,
  };
}

export function fallbackTargeting(): TargetingSettings {
  return {
    categories: [...DEFAULT_CATEGORIES],
    minFollowers: 500,
    maxFollowers: 250000,
    englishOnly: true,
    preferUnitedStates: true,
    allowUnknownLocation: true,
    excludeAlreadyFollowing: true,
    excludeAlreadyContacted: true,
    excludeHobbyAccounts: true,
    excludeMemeAccounts: true,
    excludeLargeAgencies: true,
    excludeUnrelatedDrone: true,
    updatedAt: null,
  };
}

export const getSettings = cache(async (): Promise<DataResult<AppSettings>> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("settings")
    .select("*")
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      error: databaseErrorMessage(error),
      missingTable: isMissingRelation(error),
    };
  }

  if (!data) {
    return {
      ok: false,
      error: "Settings have not been initialized. Run the database migration.",
      missingTable: false,
    };
  }

  return { ok: true, data: appSettingsFromRow(data) };
});

export const getTargetingSettings = cache(
  async (): Promise<DataResult<TargetingSettings>> => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("targeting_settings")
      .select("*")
      .eq("id", 1)
      .maybeSingle();

    if (error) {
      return {
        ok: false,
        error: databaseErrorMessage(error),
        missingTable: isMissingRelation(error),
      };
    }

    if (!data) {
      return {
        ok: false,
        error: "Targeting settings have not been initialized. Run the database migration.",
        missingTable: false,
      };
    }

    return { ok: true, data: targetingFromRow(data) };
  },
);
