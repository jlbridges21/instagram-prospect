"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { RecalculateScheduleButton } from "@/components/outreach/recalculate-schedule-button";
import { DiscoveryRunButtons } from "@/components/worker/discovery-run-buttons";
import { StartDiscoveryButton } from "@/components/worker/start-discovery-button";
import { StartOutreachButton } from "@/components/worker/start-outreach-button";
import { requestWorkerCommand } from "@/lib/actions/worker-commands";

export function HomeActions({
  online,
  discoveryRunning,
  outreachRunning,
  reviewCount,
  queueCount,
  hourlyMaximum,
  dailyMaximum,
  minimumSpacingSeconds,
  browserRestart = false,
}: {
  online: boolean;
  discoveryRunning: boolean;
  outreachRunning: boolean;
  reviewCount: number;
  queueCount: number;
  hourlyMaximum?: number;
  dailyMaximum?: number;
  minimumSpacingSeconds?: number;
  browserRestart?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [pausing, setPausing] = useState(false);

  function pauseOutreach() {
    setPausing(true);
    void requestWorkerCommand("pause_outreach", {}).then((result) => {
      setPausing(false);
      if (!result.ok) toast.error(result.error);
      else toast.success(result.message ?? "Pausing Outreach.");
    });
  }

  function fillReview(reviewTarget: number) {
    startTransition(async () => {
      const result = await requestWorkerCommand("start_discovery", {
        mode: "review_target",
        reviewTarget,
      });
      if (!result.ok) toast.error(result.error);
      else toast.success(result.message ?? "Starting Discovery.");
    });
  }

  function restartBrowser() {
    startTransition(async () => {
      const result = await requestWorkerCommand("restart_browser_session_if_safe", {});
      if (!result.ok) toast.error(result.error);
      else toast.success(result.message ?? "Restarting the browser.");
    });
  }

  function testDiscovery() {
    startTransition(async () => {
      const result = await requestWorkerCommand("run_discovery_test", {});
      if (!result.ok) toast.error(result.error);
      else toast.success(result.message ?? "Test sent.");
    });
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <h2 className="text-sm font-semibold text-slate-50">Controls</h2>
      <div className="mt-3 flex flex-wrap gap-2">
        {[20, 50, 100].map((target) => (
          <button key={target} type="button" title={`Start Discovery until Review reaches ${target}. Saved hourly pace stays unchanged.`} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-100 disabled:opacity-50" disabled={!online || discoveryRunning || pending} onClick={() => fillReview(target)}>
            Fill Review to {target}
          </button>
        ))}
        {browserRestart ? (
          <button type="button" title="Relaunch the dedicated Instagram browser. No Follow or DM is sent." className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-100 disabled:opacity-50" disabled={pending} onClick={restartBrowser}>
            Restart Browser
          </button>
        ) : null}
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <Action
          title="Fill Review to Target"
          help="Run Discovery until your Review queue reaches the target you choose."
        >
          <StartDiscoveryButton disabled={!online} reviewCount={reviewCount} />
        </Action>
        <Action
          title="Run Test — Discovery 10 Profiles"
          help="Inspect up to 10 profiles without starting a full run. No Follow or DM."
        >
          <button
            type="button"
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-800 disabled:opacity-50"
            disabled={!online || pending}
            onClick={testDiscovery}
          >
            {pending ? "Running test..." : "Run test"}
          </button>
        </Action>
        <Action
          title={discoveryRunning ? "Pause or stop Discovery" : "Discovery is not running"}
          help="Pause keeps this session available to resume. Stop ends it."
        >
          <DiscoveryRunButtons online={online} running={discoveryRunning} />
        </Action>
        <Action title="Recalculate Outreach Schedule" help="Updates queued, not-yet-started outreach timing. Completed and uncertain jobs stay as they are.">
          <RecalculateScheduleButton />
        </Action>
        <Action
          title={outreachRunning ? "Pause Outreach" : "Start Outreach"}
          help="Begin processing approved prospects using your saved pacing settings."
        >
          {outreachRunning ? (
            <button
              type="button"
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium disabled:opacity-50"
              disabled={!online || pausing}
              onClick={pauseOutreach}
            >
              {pausing ? "Pausing..." : "Pause Outreach"}
            </button>
          ) : (
            <StartOutreachButton
              disabled={!online}
              ready={queueCount}
              hourlyMaximum={hourlyMaximum}
              dailyMaximum={dailyMaximum}
              minimumSpacingSeconds={minimumSpacingSeconds}
            />
          )}
        </Action>
      </div>
    </section>
  );
}

function Action({ title, help, children }: { title: string; help: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-white/10 p-3">
      <p className="text-sm font-medium text-slate-100">{title}</p>
      <p className="mt-1 text-xs leading-5 text-slate-400">{help}</p>
      <div className="mt-3">{children}</div>
    </div>
  );
}
