import { CopyButton } from "@/components/ui/copy-button";
import type { WorkerHealthState } from "@/lib/utils/worker-health";
import { cn } from "@/lib/utils/cn";

const steps = [
  "Install Node.js on the Mac or Windows computer that will run the worker.",
  "Clone or download this project onto that computer.",
  "Add the environment variables from .env.example to .env.local.",
  "Run npm install in the project folder.",
  "Run npm run agent. Today this only reports that the worker is not built yet.",
  "When the worker exists, log into Instagram in its dedicated browser profile. Do not put the Instagram password in this app.",
];

const dot: Record<WorkerHealthState, string> = {
  online: "bg-green-600",
  stale: "bg-amber-500",
  offline: "bg-slate-300",
};

export function WorkerStatusPanel({
  health,
  rows,
  connected,
}: {
  health: { state: WorkerHealthState; label: string };
  rows: { label: string; value: string }[];
  connected: boolean;
}) {
  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-900">Current worker</h2>
          <span className="inline-flex items-center gap-2 text-sm font-medium text-slate-800">
            <span className={cn("h-2 w-2 rounded-full", dot[health.state])} aria-hidden />
            {health.label}
          </span>
        </div>
        {connected ? null : (
          <p className="border-b border-slate-100 px-5 py-3 text-sm text-slate-600">
            No local worker is currently connected.
          </p>
        )}
        <dl className="grid gap-4 px-5 py-5 sm:grid-cols-2">
          {rows.map((row) => (
            <div key={row.label}>
              <dt className="text-xs text-slate-500">{row.label}</dt>
              <dd className="mt-1 text-sm text-slate-900">{row.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900">Agent setup</h2>
        <p className="mt-1 text-sm leading-6 text-slate-600">
          Run the worker locally with <code className="text-slate-800">npm run agent</code>. The dashboard stays on Vercel, data stays in Supabase, and the browser worker stays on a local Mac or Windows machine.
        </p>
        <ol className="mt-4 space-y-3">
          {steps.map((step, index) => (
            <li key={step} className="flex gap-3 text-sm leading-6 text-slate-700">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-slate-100 text-xs font-medium text-slate-600">
                {index + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
        <div className="mt-5 flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <code className="text-sm text-slate-800">npm run agent</code>
          <CopyButton value="npm run agent" label="Copy" variant="ghost" />
        </div>
      </section>
    </div>
  );
}
