export function ProgressMetric({
  label,
  value,
  max,
  hint,
}: {
  label: string;
  value: number;
  max?: number | "unlimited" | null;
  hint?: string;
}) {
  const capped = typeof max === "number" && max > 0;
  const width = capped ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const text = max === "unlimited" ? `${value} / Unlimited` : capped ? `${value} / ${max}` : String(value);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-medium text-slate-500">{label}</p>
        <p className="text-sm font-semibold tabular-nums text-slate-900">{text}</p>
      </div>
      {capped ? (
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} aria-label={label}>
          <div className="h-full rounded-full bg-indigo-600" style={{ width: `${width}%` }} />
        </div>
      ) : null}
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}
