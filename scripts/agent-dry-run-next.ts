import { createClient } from "@supabase/supabase-js";
import { claimPaceDecision, formatOutreachSelection, nextProspectSlot, type PaceJob } from "../lib/outreach/pace";
import { loadLocalEnv } from "./load-env";

loadLocalEnv();

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.log("Dry-run needs the outreach database environment. No job was claimed.");
    return;
  }
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const now = new Date();
  const settings = await supabase.from("settings").select("timezone, minimum_action_delay_seconds, hourly_maximum, daily_maximum").eq("id", 1).maybeSingle();
  if (settings.error || !settings.data) {
    console.log("Could not read outreach settings. No job was claimed.");
    return;
  }
  const jobs: Array<Record<string, unknown>> = [];
  for (let from = 0; from < 5000; from += 500) {
    const page = await supabase
      .from("outreach_jobs")
      .select("id, prospect_id, job_type, status, scheduled_for, available_at, started_at, completed_at, created_at, result, last_error")
      .order("created_at", { ascending: true })
      .range(from, from + 499);
    if (page.error) {
      console.log("Could not read the outreach queue. No job was claimed.");
      return;
    }
    jobs.push(...(page.data ?? []));
    if ((page.data ?? []).length < 500) break;
  }
  const prospectIds = [...new Set(jobs.map((job) => String(job.prospect_id)))];
  const names = new Map<string, string>();
  for (let index = 0; index < prospectIds.length; index += 100) {
    const slice = prospectIds.slice(index, index + 100);
    const people = await supabase.from("prospects").select("id, instagram_username").in("id", slice);
    for (const person of people.data ?? []) names.set(person.id, person.instagram_username);
  }
  const paceJobs: PaceJob[] = jobs.map((job) => ({
    id: String(job.id),
    prospectId: String(job.prospect_id),
    username: names.get(String(job.prospect_id)) ?? null,
    jobType: String(job.job_type),
    status: String(job.status),
    scheduledFor: String(job.scheduled_for),
    availableAt: job.available_at ? String(job.available_at) : null,
    startedAt: job.started_at ? String(job.started_at) : null,
    completedAt: job.completed_at ? String(job.completed_at) : null,
    createdAt: job.created_at ? String(job.created_at) : null,
    result: job.result,
    lastError: typeof job.last_error === "string" ? job.last_error : null,
  }));
  const sends = paceJobs
    .filter((job) => job.jobType === "send_message" && job.status === "completed" && job.completedAt)
    .map((job) => new Date(job.completedAt as string));
  const follows = paceJobs
    .filter((job) => job.jobType === "follow_profile" && job.status === "completed" && job.completedAt)
    .map((job) => new Date(job.completedAt as string));
  const latest = (values: Date[]) => values.reduce<Date | null>((best, value) => (!best || value > best ? value : best), null);
  const decision = claimPaceDecision({
    now,
    timeZone: settings.data.timezone ?? "America/Chicago",
    minimumSpacingSeconds: settings.data.minimum_action_delay_seconds ?? 0,
    hourlyMaximum: settings.data.hourly_maximum ?? 20,
    dailyMaximum: settings.data.daily_maximum ?? 150,
    completedSendTimes: sends,
    jobs: paceJobs,
  });
  const slot = nextProspectSlot({
    now,
    timeZone: settings.data.timezone ?? "America/Chicago",
    minimumSpacingSeconds: settings.data.minimum_action_delay_seconds ?? 0,
    hourlyMaximum: settings.data.hourly_maximum ?? 20,
    dailyMaximum: settings.data.daily_maximum ?? 150,
    completedSendTimes: sends,
  });
  console.log(formatOutreachSelection({
    counts: decision.counts,
    username: decision.username,
    selection: decision.selection,
    detail: decision.detail,
    nextAt: decision.at,
    timeZone: settings.data.timezone ?? "America/Chicago",
    now,
  }));
  console.log(`Last completed send: ${latest(sends)?.toISOString() ?? "none"}`);
  console.log(`Last completed follow: ${latest(follows)?.toISOString() ?? "none"}`);
  console.log(`Spacing blocks a fresh job: ${slot.at.getTime() > now.getTime() + 1000 ? "yes" : "no"}`);
  console.log("No job was claimed. No Follow click was made. No DM was sent.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Dry-run failed.");
  process.exitCode = 1;
});
