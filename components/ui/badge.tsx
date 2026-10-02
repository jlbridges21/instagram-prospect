import { cn } from "@/lib/utils/cn";
import type { FitLabel, ProspectStatus } from "@/lib/constants/prospects";
import { FIT_LABELS_TEXT, STATUS_LABELS } from "@/lib/constants/prospects";

const statusClasses: Record<ProspectStatus, string> = {
  discovered: "bg-slate-50 text-slate-700 ring-slate-200",
  qualified: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  review: "bg-amber-50 text-amber-800 ring-amber-200",
  approved: "bg-blue-50 text-blue-700 ring-blue-200",
  contacted: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  replied: "bg-green-50 text-green-700 ring-green-200",
  follow_up: "bg-amber-50 text-amber-800 ring-amber-200",
  demo_booked: "bg-blue-50 text-blue-700 ring-blue-200",
  converted: "bg-green-50 text-green-800 ring-green-200",
  skipped: "bg-slate-50 text-slate-600 ring-slate-200",
  disqualified: "bg-red-50 text-red-700 ring-red-200",
};

const fitClasses: Record<FitLabel, string> = {
  strong_fit: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  possible_fit: "bg-amber-50 text-amber-800 ring-amber-200",
  skip: "bg-slate-50 text-slate-600 ring-slate-200",
};

export function Badge({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: ProspectStatus }) {
  return <Badge className={statusClasses[status]}>{STATUS_LABELS[status]}</Badge>;
}

export function FitBadge({ label }: { label: FitLabel | null }) {
  if (!label) return <Badge className="bg-slate-50 text-slate-500 ring-slate-200">Unscored</Badge>;
  return <Badge className={fitClasses[label]}>{FIT_LABELS_TEXT[label]}</Badge>;
}
