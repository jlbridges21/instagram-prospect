"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/actions/prospects";
import {
  cancelProspectOutreach,
  rescheduleJob,
  retryFailedJob,
  setAutomation,
  updateQueuedMessage,
} from "@/lib/outreach/service";
import { localInputToUtc } from "@/lib/outreach/time";
import { fallbackSettings, getSettings } from "@/lib/db/settings";
import { requireUser } from "@/lib/supabase/auth";
import { isUuid } from "@/lib/utils/format";

function revalidateOutreach(ids: string[] = []) {
  revalidatePath("/");
  revalidatePath("/outreach");
  revalidatePath("/prospects");
  revalidatePath("/review");
  revalidatePath("/worker");
  revalidatePath("/analytics");
  revalidatePath("/settings");
  ids.forEach((id) => revalidatePath(`/prospects/${id}`));
}

export async function pendingOutreachCount(): Promise<{ ok: true; prospects: number } | { ok: false; error: string }> {
  const { supabase } = await requireUser();
  const { data, error } = await supabase
    .from("outreach_jobs")
    .select("prospect_id")
    .in("status", ["pending", "retry_wait"]);
  if (error) return { ok: false, error: "Pending outreach could not be counted." };
  return { ok: true, prospects: new Set((data ?? []).map((job) => job.prospect_id)).size };
}

export async function pauseAutomation(cancelPending: boolean): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  const result = await setAutomation(supabase, false, user.email ?? "authenticated user", cancelPending);
  if (!result.ok) return result;
  revalidateOutreach();
  return {
    ok: true,
    message: cancelPending
      ? "Automation paused and pending outreach was cancelled."
      : "Automation paused. Queued jobs were kept.",
  };
}

export async function resumeAutomation(): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  const result = await setAutomation(supabase, true, user.email ?? "authenticated user", false);
  if (!result.ok) return result;
  revalidateOutreach();
  return { ok: true, message: "Outreach automation is running." };
}

export async function cancelOutreach(prospectId: string): Promise<ActionResult> {
  if (!isUuid(prospectId)) return { ok: false, error: "That prospect could not be found." };
  const { supabase, user } = await requireUser();
  const result = await cancelProspectOutreach(supabase, prospectId, user.email ?? "authenticated user");
  if (!result.ok) return result;
  revalidateOutreach([prospectId]);
  return { ok: true, message: "Remaining outreach was cancelled." };
}

export async function retryOutreachJob(jobId: string): Promise<ActionResult> {
  if (!isUuid(jobId)) return { ok: false, error: "That job could not be found." };
  const { supabase, user } = await requireUser();
  const result = await retryFailedJob(supabase, jobId, user.email ?? "authenticated user");
  if (!result.ok) return result;
  revalidateOutreach();
  return { ok: true, message: "The job was queued again." };
}

export async function rescheduleOutreachJob(jobId: string, localDateTime: string): Promise<ActionResult> {
  if (!isUuid(jobId)) return { ok: false, error: "That job could not be found." };
  const settingsResult = await getSettings();
  const settings = settingsResult.ok ? settingsResult.data : fallbackSettings();
  const scheduledFor = localInputToUtc(localDateTime, settings.timezone);
  if (!scheduledFor) return { ok: false, error: "Choose a valid date and time." };

  const { supabase, user } = await requireUser();
  const result = await rescheduleJob(supabase, jobId, scheduledFor, user.email ?? "authenticated user");
  if (!result.ok) return result;
  revalidateOutreach();
  return { ok: true, message: "The job was rescheduled." };
}

export async function saveQueuedMessage(prospectId: string, message: string): Promise<ActionResult> {
  if (!isUuid(prospectId)) return { ok: false, error: "That prospect could not be found." };
  const { supabase } = await requireUser();
  const result = await updateQueuedMessage(supabase, prospectId, message);
  if (!result.ok) return result;
  revalidateOutreach([prospectId]);
  return { ok: true, message: "The queued message was updated." };
}

export async function saveOutreachSettings(input: {
  automationEnabled: boolean;
  hourlyMinimum: number;
  hourlyMaximum: number;
  dailyMaximum: number;
  minimumActionDelaySeconds: number;
  schedulingSpreadSeconds: number;
  claimLeaseSeconds: number;
}): Promise<ActionResult> {
  if (!Number.isInteger(input.hourlyMinimum) || input.hourlyMinimum < 1 || input.hourlyMinimum > 100) {
    return { ok: false, error: "Hourly minimum must be a whole number from 1 to 100." };
  }
  if (
    !Number.isInteger(input.hourlyMaximum) ||
    input.hourlyMaximum < input.hourlyMinimum ||
    input.hourlyMaximum > 100
  ) {
    return { ok: false, error: "Hourly maximum must be at least the minimum, and no more than 100." };
  }
  if (!Number.isInteger(input.dailyMaximum) || input.dailyMaximum < 1 || input.dailyMaximum > 5000) {
    return { ok: false, error: "Daily maximum must be a whole number from 1 to 5000." };
  }
  if (
    !Number.isInteger(input.minimumActionDelaySeconds) ||
    input.minimumActionDelaySeconds < 30 ||
    input.minimumActionDelaySeconds > 7200
  ) {
    return { ok: false, error: "Minimum delay must be between 30 and 7200 seconds." };
  }
  if (
    !Number.isInteger(input.schedulingSpreadSeconds) ||
    input.schedulingSpreadSeconds < 0 ||
    input.schedulingSpreadSeconds > 7200
  ) {
    return { ok: false, error: "Scheduling spread must be between 0 and 7200 seconds." };
  }
  if (
    !Number.isInteger(input.claimLeaseSeconds) ||
    input.claimLeaseSeconds < 60 ||
    input.claimLeaseSeconds > 3600
  ) {
    return { ok: false, error: "Claim lease must be between 60 and 3600 seconds." };
  }

  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("settings")
    .update({
      automation_enabled: input.automationEnabled,
      hourly_minimum: input.hourlyMinimum,
      hourly_maximum: input.hourlyMaximum,
      daily_maximum: input.dailyMaximum,
      minimum_action_delay_seconds: input.minimumActionDelaySeconds,
      scheduling_spread_seconds: input.schedulingSpreadSeconds,
      job_claim_lease_seconds: input.claimLeaseSeconds,
    })
    .eq("id", 1);
  if (error) return { ok: false, error: error.message };
  revalidateOutreach();
  return { ok: true };
}
