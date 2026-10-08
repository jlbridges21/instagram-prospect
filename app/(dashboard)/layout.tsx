import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { getDiscoveryV3Snapshot } from "@/lib/db/discovery";
import { getOutreachSnapshot } from "@/lib/db/outreach";
import { fallbackSettings, getSettings } from "@/lib/db/settings";
import { getLatestWorker } from "@/lib/db/workers";
import { parseHourlyWaitEvent } from "@/lib/discovery/pacing";
import { attentionKind, formatDiscoveryStatus, formatOutreachStatus } from "@/lib/status/operations";
import { requireUser } from "@/lib/supabase/auth";
import { getPublicSupabaseEnv } from "@/lib/supabase/env";
import { parseBrowserHealthEvent } from "@/lib/worker/browser-health";
import { getWorkerHealth } from "@/lib/utils/worker-health";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  if (!getPublicSupabaseEnv()) redirect("/login");
  const { user } = await requireUser();
  const [settingsResult, workerResult] = await Promise.all([getSettings(), getLatestWorker()]);
  const settings = settingsResult.ok ? settingsResult.data : fallbackSettings();
  const worker = workerResult.ok ? workerResult.data : null;
  const progress = await getDiscoveryV3Snapshot(settings.timezone);
  const health = getWorkerHealth({
    status: worker?.status ?? null,
    lastHeartbeatAt: worker?.last_heartbeat_at ?? null,
    heartbeatIntervalSeconds: settings.heartbeatIntervalSeconds,
    currentTask: worker?.current_task,
    attentionReason: worker?.attention_reason,
  });
  const online = health.state === "online" || health.state === "attention";
  const outreach = await getOutreachSnapshot(settings.timezone);
  const hourly = settings.discovery.enabled ? parseHourlyWaitEvent(worker?.last_event) : null;
  const browser = parseBrowserHealthEvent(worker?.last_event)?.state ?? "connected";
  const discovery = formatDiscoveryStatus({
    online,
    enabled: settings.discovery.enabled,
    stopReason: settings.discovery.stopReason,
    hourly,
    attention: attentionKind(worker?.current_task, worker?.attention_reason),
    attentionText: worker?.attention_reason,
    reviewCount: progress.currentReview,
    reviewTarget: settings.discovery.reviewTarget,
    browser,
  });
  const outreachStatus = formatOutreachStatus({
    online,
    enabled: settings.outreach.automationEnabled,
    queueCount: outreach?.queueProspects ?? 0,
    pacingWait: null,
    acting: worker?.current_task?.startsWith("executing_") === true,
    attention: attentionKind(worker?.current_task, worker?.attention_reason),
    attentionText: worker?.attention_reason,
    browser,
  });

  return (
    <AppShell
      email={user.email ?? "Signed in"}
      workerOnline={online}
      timeZone={settings.timezone}
      reviewCount={progress.currentReview}
      strip={{
        discovery: discovery.actual,
        discoveryDetail: hourly ? `${hourly.count} / ${hourly.limit} this hour` : `${progress.dailyInspections} inspected today`,
        reviewDetail: `${progress.currentReview} waiting`,
        outreach: outreachStatus.actual,
        outreachDetail: outreachStatus.reason,
        workerDetail: online ? "Windows automation ready" : "Start the Windows worker",
      }}
    >
      {children}
    </AppShell>
  );
}
