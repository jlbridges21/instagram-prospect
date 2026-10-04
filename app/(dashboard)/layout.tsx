import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { fallbackSettings, getSettings } from "@/lib/db/settings";
import { getLatestWorker } from "@/lib/db/workers";
import { requireUser } from "@/lib/supabase/auth";
import { getPublicSupabaseEnv } from "@/lib/supabase/env";
import { getWorkerHealth } from "@/lib/utils/worker-health";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  if (!getPublicSupabaseEnv()) redirect("/login");
  const { user } = await requireUser();
  const [settingsResult, workerResult] = await Promise.all([getSettings(), getLatestWorker()]);
  const settings = settingsResult.ok ? settingsResult.data : fallbackSettings();
  const worker = workerResult.ok ? workerResult.data : null;
  const health = getWorkerHealth({
    status: worker?.status ?? null,
    lastHeartbeatAt: worker?.last_heartbeat_at ?? null,
    heartbeatIntervalSeconds: settings.heartbeatIntervalSeconds,
    currentTask: worker?.current_task,
    attentionReason: worker?.attention_reason,
  });

  return (
    <AppShell
      email={user.email ?? "Signed in"}
      workerOnline={health.state === "online" || health.state === "attention"}
      timeZone={settings.timezone}
    >
      {children}
    </AppShell>
  );
}
