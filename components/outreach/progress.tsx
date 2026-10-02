import type { OutreachJobRow } from "@/lib/db/types";
import { JOB_STATUS_LABELS, JOB_TYPE_LABELS } from "@/lib/outreach/types";
import { cn } from "@/lib/utils/cn";

const STEPS = [
  { key: "approved", label: "Approved" },
  { key: "message", label: "Message locked" },
  { key: "verify_profile", label: "Verify profile" },
  { key: "follow_profile", label: "Follow account" },
  { key: "send_message", label: "Send message" },
  { key: "contacted", label: "Contacted" },
] as const;

export function OutreachProgress({
  approved,
  messageLocked,
  contacted,
  alreadyFollowing,
  cancelled,
  jobs,
}: {
  approved: boolean;
  messageLocked: boolean;
  contacted: boolean;
  alreadyFollowing: boolean;
  cancelled: boolean;
  jobs: OutreachJobRow[];
}) {
  const verify = jobs.find((job) => job.job_type === "verify_profile");
  const stoppedForFollow = alreadyFollowing && verify?.status === "completed";

  return (
    <ol className="space-y-3">
      {STEPS.map((step) => {
        const job = jobs.find((item) => item.job_type === step.key);
        const state = stepState({
          key: step.key,
          approved,
          messageLocked,
          contacted,
          job,
          stoppedForFollow,
          cancelled,
        });
        return (
          <li key={step.key} className="flex items-start gap-3">
            <span
              className={cn(
                "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                state === "done" && "bg-indigo-600 text-white",
                state === "current" && "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200",
                state === "wait" && "bg-slate-100 text-slate-400",
                state === "stop" && "bg-amber-100 text-amber-800",
              )}
              aria-hidden
            >
              {state === "done" ? "✓" : state === "stop" ? "!" : "○"}
            </span>
            <div>
              <p className="text-sm font-medium text-slate-900">{step.label}</p>
              <p className="text-xs text-slate-500">
                {detail({
                  key: step.key,
                  job,
                  stoppedForFollow,
                  cancelled,
                  state,
                })}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function stepState(input: {
  key: (typeof STEPS)[number]["key"];
  approved: boolean;
  messageLocked: boolean;
  contacted: boolean;
  job: OutreachJobRow | undefined;
  stoppedForFollow: boolean;
  cancelled: boolean;
}) {
  if (input.key === "approved") return input.approved ? "done" : "wait";
  if (input.key === "message") return input.messageLocked ? "done" : "wait";
  if (input.key === "contacted") return input.contacted ? "done" : "wait";
  if (input.stoppedForFollow && input.key !== "verify_profile") return "stop";
  if (!input.job) return "wait";
  if (input.job.status === "completed") return "done";
  if (input.job.status === "failed" || input.job.status === "cancelled") return "stop";
  if (input.job.status === "running" || input.job.status === "claimed") return "current";
  return "wait";
}

function detail(input: {
  key: (typeof STEPS)[number]["key"];
  job: OutreachJobRow | undefined;
  stoppedForFollow: boolean;
  cancelled: boolean;
  state: string;
}) {
  if (input.stoppedForFollow && input.key === "follow_profile") return "Already following. Outreach stopped.";
  if (input.stoppedForFollow && input.key === "send_message") return "Message was not queued to send.";
  if (input.key === "verify_profile" || input.key === "follow_profile" || input.key === "send_message") {
    if (!input.job) return input.cancelled ? "Not queued" : "Waiting";
    return JOB_STATUS_LABELS[input.job.status];
  }
  if (input.key === "contacted" && input.stoppedForFollow) return "Not contacted";
  if (input.state === "done") return "Done";
  return "Waiting";
}

export function jobTypeLabel(type: string) {
  if (type === "verify_profile" || type === "follow_profile" || type === "send_message") {
    return JOB_TYPE_LABELS[type];
  }
  return type;
}
