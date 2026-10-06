"use client";

import { useState, useTransition } from "react";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { SettingsPanel } from "@/components/settings/settings-panel";
import { deleteSeeds, saveDiscoveryOptimization, setSeedsActive } from "@/lib/actions/seeds";
import { setDiscoveryEnabled } from "@/lib/actions/settings";
import { saveDiscoveryPreferences } from "@/lib/actions/discovery";
import { reviewYield } from "@/lib/discovery/seeds";
import type { AppSettings, DiscoveryOptimization, TargetingSettings } from "@/lib/db/models";
import type { DiscoverySeedRow } from "@/lib/db/types";

export function MobileSettings({
  settings,
  targeting,
  openaiConfigured,
  seeds,
  optimization,
}: {
  settings: AppSettings;
  targeting: TargetingSettings;
  openaiConfigured: boolean;
  seeds: DiscoverySeedRow[];
  optimization: DiscoveryOptimization;
}) {
  return (
    <div className="space-y-3 md:hidden">
      <div className="mb-2">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">Settings</h1>
        <p className="mt-1 text-sm text-slate-400">Rules, seeds, and worker preferences.</p>
      </div>
      <Accordion title="Discovery" description="Turn inspection on or set the hourly pace." open>
        <DiscoveryControls enabled={settings.discovery.enabled} hourly={settings.discovery.maxProfilesPerHour} reviewTarget={settings.discovery.reviewTarget} />
      </Accordion>
      <Accordion title="Outreach" description="Message, pacing, and daily limits live in Advanced.">
        <p className="text-sm leading-6 text-slate-300">The locked outreach message and send limits stay on the existing settings actions. Open Advanced to edit them.</p>
      </Accordion>
      <Accordion title="Discovery Seeds" description="Accounts used to find more prospects.">
        <MobileSeeds seeds={seeds} />
      </Accordion>
      <Accordion title="Discovery Optimization" description="Automatic promotion and fit threshold.">
        <OptimizationForm optimization={optimization} />
      </Accordion>
      <Accordion title="Candidate Prioritization" description="Minimum score before a profile is opened.">
        <PreScoreForm optimization={optimization} />
      </Accordion>
      <Accordion title="Worker" description="The Windows worker reports through the same status feed.">
        <p className="text-sm leading-6 text-slate-300">Browser, heartbeat, and app preferences are in Advanced. The phone view reads the same worker connection as desktop.</p>
      </Accordion>
      <Accordion title="Advanced" description="The full settings forms, unchanged.">
        <AdvancedSettings settings={settings} targeting={targeting} openaiConfigured={openaiConfigured} />
      </Accordion>
    </div>
  );
}

function Accordion({ title, description, open = false, children }: { title: string; description: string; open?: boolean; children: React.ReactNode }) {
  const [expanded, setExpanded] = useState(open);
  return (
    <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
      <button type="button" className="flex min-h-16 w-full items-center justify-between gap-3 px-4 py-3 text-left" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
        <span>
          <span className="block text-[17px] font-semibold text-slate-50">{title}</span>
          <span className="mt-0.5 block text-xs text-slate-400">{description}</span>
        </span>
        <span className="text-slate-400">{expanded ? "–" : "+"}</span>
      </button>
      {expanded ? <div className="border-t border-white/10 px-4 py-4">{children}</div> : null}
    </section>
  );
}

function DiscoveryControls({ enabled, hourly, reviewTarget }: { enabled: boolean; hourly: number; reviewTarget: number | "unlimited" }) {
  const [pending, startTransition] = useTransition();
  const [pace, setPace] = useState(String(hourly));

  return (
    <div className="space-y-3">
      <button
        type="button"
        className="min-h-12 w-full rounded-2xl bg-gradient-to-r from-indigo-500 to-violet-500 text-sm font-semibold text-white disabled:opacity-50"
        disabled={pending}
        onClick={() => startTransition(async () => {
          const result = await setDiscoveryEnabled(!enabled);
          if (!result.ok) toast.error(result.error);
          else toast.success(result.message ?? (enabled ? "Discovery is off." : "Discovery is on."));
        })}
      >
        {enabled ? "Turn Discovery off" : "Turn Discovery on"}
      </button>
      <label className="block text-xs text-slate-400">Profiles per hour
        <input value={pace} onChange={(event) => setPace(event.target.value)} inputMode="numeric" className="mt-1 h-12 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-slate-50" />
      </label>
      <button
        type="button"
        className="min-h-12 w-full rounded-2xl border border-white/10 text-sm font-medium text-slate-100 disabled:opacity-50"
        disabled={pending}
        onClick={() => startTransition(async () => {
          const result = await saveDiscoveryPreferences({
            reviewTarget: reviewTarget === "unlimited" ? 20 : reviewTarget,
            hourlyPace: Number.parseInt(pace, 10),
          });
          if (!result.ok) toast.error(result.error);
          else toast.success(result.message ?? "Saved.");
        })}
      >
        Save pace
      </button>
    </div>
  );
}

function OptimizationForm({ optimization }: { optimization: DiscoveryOptimization }) {
  const [pending, startTransition] = useTransition();
  const [auto, setAuto] = useState(optimization.autoPromote);
  const [score, setScore] = useState(String(optimization.autoPromoteMinScore));

  return (
    <form className="space-y-3" onSubmit={(event) => {
      event.preventDefault();
      startTransition(async () => {
        const result = await saveDiscoveryOptimization({ ...optimization, autoPromote: auto, autoPromoteMinScore: Number.parseInt(score, 10) });
        if (!result.ok) toast.error(result.error);
        else toast.success(result.message ?? "Discovery optimization saved.");
      });
    }}>
      <label className="flex min-h-12 items-center justify-between gap-3 text-sm text-slate-100">
        Promote qualified prospects
        <input type="checkbox" checked={auto} onChange={(event) => setAuto(event.target.checked)} className="h-5 w-5" />
      </label>
      <label className="block text-xs text-slate-400">Fit score threshold
        <input value={score} onChange={(event) => setScore(event.target.value)} inputMode="numeric" className="mt-1 h-12 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-slate-50" />
      </label>
      <button type="submit" className="min-h-12 w-full rounded-2xl bg-gradient-to-r from-indigo-500 to-violet-500 text-sm font-semibold text-white disabled:opacity-50" disabled={pending}>Save</button>
    </form>
  );
}

function PreScoreForm({ optimization }: { optimization: DiscoveryOptimization }) {
  const [pending, startTransition] = useTransition();
  const [floor, setFloor] = useState(String(optimization.minCandidatePreScore));
  return (
    <form className="space-y-3" onSubmit={(event) => {
      event.preventDefault();
      startTransition(async () => {
        const result = await saveDiscoveryOptimization({ ...optimization, minCandidatePreScore: Number.parseInt(floor, 10) });
        if (!result.ok) toast.error(result.error);
        else toast.success(result.message ?? "Discovery optimization saved.");
      });
    }}>
      <label className="block text-xs text-slate-400">Minimum candidate pre-score
        <input value={floor} onChange={(event) => setFloor(event.target.value)} inputMode="numeric" className="mt-1 h-12 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-slate-50" />
      </label>
      <button type="submit" className="min-h-12 w-full rounded-2xl border border-white/10 text-sm font-medium text-slate-100 disabled:opacity-50" disabled={pending}>Save</button>
    </form>
  );
}

function MobileSeeds({ seeds }: { seeds: DiscoverySeedRow[] }) {
  const [menu, setMenu] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (seeds.length === 0) return <p className="text-sm text-slate-400">No Discovery Seeds yet.</p>;
  return (
    <div className="space-y-2">
      {seeds.map((seed) => {
        const yieldPercent = Math.round(reviewYield(seed.profiles_inspected, seed.profiles_reaching_review) * 100);
        const source = seed.source_type === "auto_promoted" ? "Auto-promoted" : seed.source_type === "system_imported" ? "Imported" : "Manual";
        return (
          <div key={seed.id} className="rounded-2xl border border-white/10 px-3 py-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[15px] font-semibold text-slate-50">@{seed.instagram_username}</p>
                <p className="text-xs text-slate-400">{seed.is_active ? "Active" : "Disabled"} · {source}</p>
              </div>
              <button type="button" className="inline-flex h-11 w-11 items-center justify-center rounded-full text-slate-300" aria-label={`Actions for @${seed.instagram_username}`} onClick={() => setMenu(seed.id)}>
                <MoreHorizontal className="h-5 w-5" />
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-300">{seed.profiles_inspected} inspected · {seed.profiles_reaching_review} Review · {yieldPercent}% yield</p>
            {menu === seed.id ? (
              <div className="mt-2 grid gap-2">
                <button type="button" className="min-h-11 rounded-xl border border-white/10 text-sm text-slate-100 disabled:opacity-50" disabled={pending} onClick={() => startTransition(async () => {
                  const result = await setSeedsActive([seed.id], !seed.is_active);
                  if (!result.ok) toast.error(result.error);
                  else { toast.success(result.message ?? "Updated."); setMenu(null); }
                })}>{seed.is_active ? "Disable" : "Enable"}</button>
                <button type="button" className="min-h-11 rounded-xl border border-red-400/30 text-sm text-red-200 disabled:opacity-50" disabled={pending} onClick={() => startTransition(async () => {
                  const result = await deleteSeeds([seed.id]);
                  if (!result.ok) toast.error(result.error);
                  else { toast.success(result.message ?? "Removed."); setMenu(null); }
                })}>Remove</button>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function AdvancedSettings({ settings, targeting, openaiConfigured }: { settings: AppSettings; targeting: TargetingSettings; openaiConfigured: boolean }) {
  const [show, setShow] = useState(false);
  if (!show) {
    return (
      <button type="button" className="min-h-12 w-full rounded-2xl border border-white/10 text-sm font-medium text-slate-100" onClick={() => setShow(true)}>
        Open full settings
      </button>
    );
  }
  return <SettingsPanel settings={settings} targeting={targeting} openaiConfigured={openaiConfigured} />;
}
