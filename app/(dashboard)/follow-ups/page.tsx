import type { Metadata } from "next";
import { DatabaseSetup } from "@/components/layout/database-setup";
import { PageHeader } from "@/components/layout/page-header";
import { FollowUpList } from "@/components/follow-ups/follow-up-list";
import { getFollowUps } from "@/lib/db/follow-ups";
import { fallbackSettings, getSettings } from "@/lib/db/settings";
import { formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Follow-Ups" };

export default async function FollowUpsPage() {
  const [result, settingsResult] = await Promise.all([getFollowUps(), getSettings()]);
  const settings = settingsResult.ok ? settingsResult.data : fallbackSettings();
  const rows = result.ok ? result.data : [];

  return (
    <div>
      <PageHeader
        title="Follow-ups"
        description="Reminders to check back with people you have already contacted."
      />
      {!result.ok && result.missingTable ? <DatabaseSetup message={result.error} /> : null}
      {!result.ok && !result.missingTable ? (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {result.error}
        </div>
      ) : null}
      <FollowUpList
        rows={rows.map((row) => {
          const name =
            row.prospects?.display_name ||
            row.prospects?.first_name ||
            row.prospects?.instagram_username ||
            "Prospect";
          return {
            id: row.id,
            prospectId: row.prospect_id,
            name,
            username: row.prospects?.instagram_username || "unknown",
            dueLabel: formatDateTime(row.due_at, settings.timezone, settings.dateFormat),
            dueAt: row.due_at || "",
            status: row.status,
            notes: row.notes || "",
            contactedLabel: formatDateTime(
              row.prospects?.contacted_at,
              settings.timezone,
              settings.dateFormat,
              "Not contacted",
            ),
          };
        })}
      />
    </div>
  );
}
