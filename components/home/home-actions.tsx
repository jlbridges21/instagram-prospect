"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
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
}: {
  online: boolean;
  discoveryRunning: boolean;
  outreachRunning: boolean;
  reviewCount: number;
  queueCount: number;
  hourlyMaximum?: number;
  dailyMaximum?: number;
  minimumSpacingSeconds?: number;
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

  function testDiscovery() {
    startTransition(async () => {
      const result = await requestWorkerCommand("run_discovery_test", {});
      if (!result.ok) toast.error(result.error);
      else toast.success(result.message ?? "Test sent.");
    });
  }

  return (
    <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-900">Workflow</h2>
      <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
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
    <div className="rounded-lg border border-slate-200 p-3">
      <p className="text-sm font-medium text-slate-900">{title}</p>
      <p className="mt-1 text-xs leading-5 text-slate-500">{help}</p>
      <div className="mt-3">{children}</div>
    </div>
  );
}
