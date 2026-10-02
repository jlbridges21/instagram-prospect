import Link from "next/link";
import type { WorkerHealthState } from "@/lib/utils/worker-health";
import { cn } from "@/lib/utils/cn";

const dotClasses: Record<WorkerHealthState, string> = {
  online: "bg-green-600",
  stale: "bg-amber-500",
  offline: "bg-slate-300",
};

export function WorkerSummary({
  health,
  machineName,
  osLabel,
  lastHeartbeat,
  currentTask,
}: {
  health: { state: WorkerHealthState; label: string };
  machineName: string;
  osLabel: string;
  lastHeartbeat: string;
  currentTask: string;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
        <h2 className="text-sm font-semibold text-slate-900">Worker</h2>
        <Link href="/worker" className="text-sm font-medium text-indigo-600 hover:text-indigo-700">
          Details
        </Link>
      </div>
      <div className="space-y-4 px-5 py-4">
        <div className="flex items-center gap-2">
          <span className={cn("h-2 w-2 rounded-full", dotClasses[health.state])} aria-hidden />
          <span className="text-sm font-medium text-slate-900">{health.label}</span>
        </div>
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <Info label="Machine" value={machineName} />
          <Info label="Platform" value={osLabel} />
          <Info label="Last heartbeat" value={lastHeartbeat} />
          <Info label="Current task" value={currentTask} />
        </dl>
      </div>
    </section>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-1 text-slate-900">{value}</dd>
    </div>
  );
}
