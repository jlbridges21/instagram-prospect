import type { Metadata } from "next";
import { MobileSettings } from "@/components/mobile/mobile-settings";
import { DatabaseSetup } from "@/components/layout/database-setup";
import { PageHeader } from "@/components/layout/page-header";
import { DiscoverySeedsPanel } from "@/components/settings/discovery-seeds-panel";
import { SettingsPanel } from "@/components/settings/settings-panel";
import { listDiscoverySeeds, suggestedDiscoveryKeywords } from "@/lib/db/seeds";
import { isOpenAiConfigured } from "@/lib/ai/env";
import {
  fallbackSettings,
  fallbackTargeting,
  getSettings,
  getTargetingSettings,
} from "@/lib/db/settings";
import { formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Settings" };
export const maxDuration = 60;

export default async function SettingsPage() {
  const [settingsResult, targetingResult, seedsResult, suggestions] = await Promise.all([
    getSettings(),
    getTargetingSettings(),
    listDiscoverySeeds(),
    suggestedDiscoveryKeywords().catch(() => [] as string[]),
  ]);
  const settings = settingsResult.ok ? settingsResult.data : fallbackSettings();
  const targeting = targetingResult.ok ? targetingResult.data : fallbackTargeting();
  const blocked = (!settingsResult.ok && settingsResult.missingTable) ||
    (!targetingResult.ok && targetingResult.missingTable);

  return (
    <div>
      {settingsResult.ok && targetingResult.ok ? (
        <MobileSettings
          settings={settings}
          targeting={targeting}
          openaiConfigured={isOpenAiConfigured()}
          seeds={seedsResult.ok ? seedsResult.data : []}
          optimization={settings.optimization}
        />
      ) : null}
      <div className="hidden md:block">
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
        <SettingsPanel
          settings={settings}
          targeting={targeting}
          openaiConfigured={isOpenAiConfigured()}
        />
      ) : null}
      {settingsResult.ok ? (
        <DiscoverySeedsPanel
          seeds={seedsResult.ok ? seedsResult.data : []}
          optimization={settings.optimization}
          migrationNeeded={!seedsResult.ok && seedsResult.missingTable === true}
          suggestions={suggestions}
        />
      ) : null}
      </div>
    </div>
  );
}
