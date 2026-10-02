"use server";

import { revalidatePath } from "next/cache";
import { MESSAGE_NAME_TOKEN } from "@/lib/constants/message";
import {
  MAX_ACTIVE_WORKERS,
  TIMEZONES,
  isDateFormat,
  isPreferredBrowser,
} from "@/lib/constants/settings";
import type { ActionResult } from "@/lib/actions/prospects";
import { requireUser } from "@/lib/supabase/auth";

function revalidateSettings() {
  revalidatePath("/settings");
  revalidatePath("/");
  revalidatePath("/prospects");
  revalidatePath("/review");
  revalidatePath("/worker");
  revalidatePath("/analytics");
}

export async function saveMessageTemplate(template: string): Promise<ActionResult> {
  const message = template.trim();
  if (!message) return { ok: false, error: "The message cannot be empty." };
  if (!message.includes(MESSAGE_NAME_TOKEN)) {
    return {
      ok: false,
      error: `Keep ${MESSAGE_NAME_TOKEN} in the message so a name can be inserted.`,
    };
  }

  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("settings")
    .update({ message_template: message })
    .eq("id", 1);

  if (error) return { ok: false, error: error.message };
  revalidateSettings();
  return { ok: true };
}

export async function saveTargeting(input: {
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
}): Promise<ActionResult> {
  const categories = input.categories.map((category) => category.trim()).filter(Boolean);
  if (!Number.isInteger(input.minFollowers) || input.minFollowers < 0) {
    return { ok: false, error: "Minimum followers must be a whole number, 0 or higher." };
  }
  if (!Number.isInteger(input.maxFollowers) || input.maxFollowers < input.minFollowers) {
    return { ok: false, error: "Maximum followers must be at least the minimum." };
  }
  if (categories.length === 0) {
    return { ok: false, error: "Add at least one target category." };
  }

  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("targeting_settings")
    .update({
      categories,
      min_followers: input.minFollowers,
      max_followers: input.maxFollowers,
      english_only: input.englishOnly,
      prefer_united_states: input.preferUnitedStates,
      allow_unknown_location: input.allowUnknownLocation,
      exclude_already_following: input.excludeAlreadyFollowing,
      exclude_already_contacted: input.excludeAlreadyContacted,
      exclude_hobby_accounts: input.excludeHobbyAccounts,
      exclude_meme_accounts: input.excludeMemeAccounts,
      exclude_large_agencies: input.excludeLargeAgencies,
      exclude_unrelated_drone: input.excludeUnrelatedDrone,
    })
    .eq("id", 1);

  if (error) return { ok: false, error: error.message };
  revalidateSettings();
  return { ok: true };
}

export async function saveWorkerSettings(input: {
  workerEnabled: boolean;
  preferredBrowser: string;
  heartbeatIntervalSeconds: number;
}): Promise<ActionResult> {
  if (!isPreferredBrowser(input.preferredBrowser)) {
    return { ok: false, error: "Choose Chromium, Google Chrome, or Microsoft Edge." };
  }
  if (
    !Number.isInteger(input.heartbeatIntervalSeconds) ||
    input.heartbeatIntervalSeconds < 5 ||
    input.heartbeatIntervalSeconds > 600
  ) {
    return { ok: false, error: "Heartbeat interval must be between 5 and 600 seconds." };
  }

  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("settings")
    .update({
      worker_enabled: input.workerEnabled,
      preferred_browser: input.preferredBrowser,
      heartbeat_interval_seconds: input.heartbeatIntervalSeconds,
      max_active_workers: MAX_ACTIVE_WORKERS,
    })
    .eq("id", 1);

  if (error) return { ok: false, error: error.message };
  revalidateSettings();
  return { ok: true };
}

export async function saveAppSettings(input: {
  appName: string;
  timezone: string;
  dateFormat: string;
}): Promise<ActionResult> {
  const appName = input.appName.trim();
  if (!appName) return { ok: false, error: "App name cannot be empty." };
  if (!TIMEZONES.some((timezone) => timezone === input.timezone)) {
    return { ok: false, error: "Choose a timezone from the list." };
  }
  if (!isDateFormat(input.dateFormat)) {
    return { ok: false, error: "Choose a date format from the list." };
  }

  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("settings")
    .update({
      app_name: appName,
      timezone: input.timezone,
      date_format: input.dateFormat,
    })
    .eq("id", 1);

  if (error) return { ok: false, error: error.message };
  revalidateSettings();
  return { ok: true };
}
