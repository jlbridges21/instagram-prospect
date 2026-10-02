import type { Metadata } from "next";
import { AutomationControls } from "@/components/outreach/automation-controls";
import { QueueBoard } from "@/components/outreach/queue-board";
import { DatabaseSetup } from "@/components/layout/database-setup";
import { PageHeader } from "@/components/layout/page-header";
import { listOutreachJobs, getOutreachSnapshot } from "@/lib/db/outreach";
import { fallbackSettings, getSettings } from "@/lib/db/settings";
import { formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Outreach Queue" };

export default async function OutreachPage() {
  const settingsResult = await getSettings();
  const settings = settingsResult.ok ? settingsResult.data : fallbackSettings();
  const [queue, snapshot] = await Promise.all([
    listOutreachJobs(),
    getOutreachSnapshot(settings.timezone),
  ]);

  return (
    <div>
      <PageHeader
        title="Outreach Queue"
        description="Approved prospects wait here until a worker claims the next step. Approving does not send a message."
        action={<AutomationControls enabled={settings.outreach.automationEnabled} />}
      />
      {!queue.ok && queue.missingTable ? (
        <DatabaseSetup message="Run the Prompt 4 migration before using the outreach queue." />
      ) : null}
      {!queue.ok && !queue.missingTable ? (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {queue.error}
        </div>
      ) : null}
      {snapshot ? (
        <dl className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Queued prospects" value={String(snapshot.queueProspects)} />
          <Stat label="Scheduled today" value={String(snapshot.scheduledToday)} />
          <Stat label="Sent today" value={String(snapshot.sentToday)} />
          <Stat
            label="Next outreach"
            value={snapshot.nextAt ? formatDateTime(snapshot.nextAt, settings.timezone, settings.dateFormat) : "None"}
          />
        </dl>
      ) : null}
      {queue.ok ? (
        <QueueBoard
          jobs={queue.data.jobs}
          prospects={queue.data.prospects}
          timeZone={settings.timezone}
          dateFormat={settings.dateFormat}
        />
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm font-semibold text-slate-900">{value}</dd>
    </div>
  );
}
