import type { Metadata } from "next";
import { DatabaseSetup } from "@/components/layout/database-setup";
import { PageHeader } from "@/components/layout/page-header";
import { SettingsPanel } from "@/components/settings/settings-panel";
import {
  fallbackSettings,
  fallbackTargeting,
  getSettings,
  getTargetingSettings,
} from "@/lib/db/settings";
import { formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const [settingsResult, targetingResult] = await Promise.all([
    getSettings(),
    getTargetingSettings(),
  ]);
  const settings = settingsResult.ok ? settingsResult.data : fallbackSettings();
  const targeting = targetingResult.ok ? targetingResult.data : fallbackTargeting();
  const blocked = (!settingsResult.ok && settingsResult.missingTable) ||
    (!targetingResult.ok && targetingResult.missingTable);

  return (
    <div>
      <PageHeader
        title="Settings"
        description={
          settings.updatedAt
            ? `Last saved ${formatDateTime(settings.updatedAt, settings.timezone, settings.dateFormat)}.`
            : "Message, targeting, and worker preferences for this workspace."
        }
      />
      {blocked ? (
        <div className="mb-6">
          <DatabaseSetup
            message={
              !settingsResult.ok
                ? settingsResult.error
                : !targetingResult.ok
                  ? targetingResult.error
                  : "Run the migration."
            }
          />
        </div>
      ) : null}
      {!blocked && !settingsResult.ok ? (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {settingsResult.error}
        </div>
      ) : null}
      {!blocked && settingsResult.ok && !targetingResult.ok ? (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {targetingResult.error}
        </div>
      ) : null}
      {settingsResult.ok && targetingResult.ok ? (
        <SettingsPanel settings={settings} targeting={targeting} />
      ) : null}
    </div>
  );
}
