import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint: string;
  icon?: LucideIcon;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
        {Icon ? <Icon className="h-4 w-4 text-slate-400" aria-hidden /> : null}
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight text-slate-900">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </div>
  );
}

export function FunnelChart({
  stages,
}: {
  stages: { label: string; count: number; detail?: string }[];
}) {
  const max = Math.max(...stages.map((stage) => stage.count), 1);

  return (
    <div className="space-y-3">
      {stages.map((stage) => (
        <div key={stage.label}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="text-slate-700">{stage.label}</span>
            <span className="tabular-nums text-slate-900">
              {stage.count}
              {stage.detail ? (
                <span className="ml-2 text-xs text-slate-500">{stage.detail}</span>
              ) : null}
            </span>
          </div>
          <div className="h-2 rounded-md bg-slate-100">
            <div
              className={cn(
                "h-2 rounded-md bg-indigo-600",
                stage.count === 0 && "bg-slate-200",
              )}
              style={{ width: `${Math.max((stage.count / max) * 100, stage.count > 0 ? 4 : 0)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
