import Link from "next/link";
import { formatResumeClock } from "@/lib/discovery/pacing";
import { statusDotClass, type OperationState } from "@/lib/status/operations";

export function OperationSummary({
  worker,
  discovery,
  outreach,
  action,
  review,
  today,
  timeZone,
}: {
  worker: OperationState;
  discovery: OperationState;
  outreach: OperationState;
  action: string;
  review: string;
  today: { inspected: number; ai: number; sent: number };
  timeZone: string;
}) {
  return (
    <div className="mb-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <Card href="/worker" title="Worker" state={worker} />
      <Card href="/discovery" title="Discovery" state={discovery} extra={discovery.resumesAt ? `Next profile slot opens at ${formatResumeClock(discovery.resumesAt, timeZone)}` : null} />
      <Card href="/outreach" title="Outreach" state={outreach} extra={outreach.resumesAt ? `Next window ${formatResumeClock(outreach.resumesAt, timeZone)}` : null} />
      <Link href="/worker" className="rounded-xl border border-slate-200 bg-white p-4 text-sm hover:border-indigo-200">
        <p className="text-xs font-medium text-slate-500">Current action</p>
        <p className="mt-2 font-semibold text-slate-900">{action}</p>
        <p className="mt-3 text-xs text-slate-500">Review {review}</p>
        <p className="text-xs text-slate-500">Today {today.inspected} inspected · {today.ai} AI · {today.sent} sent</p>
      </Link>
    </div>
  );
}

function Card({ href, title, state, extra }: { href: string; title: string; state: OperationState; extra?: string | null }) {
  return (
    <Link href={href} className="rounded-xl border border-slate-200 bg-white p-4 text-sm hover:border-indigo-200">
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${statusDotClass(state.tone)}`} aria-hidden />
        <p className="text-xs font-medium text-slate-500">{title}</p>
      </div>
      <p className="mt-2 font-semibold text-slate-900">{state.actual}</p>
      <p className="mt-1 text-xs text-slate-600">{state.reason}</p>
      {extra ? <p className="mt-1 text-xs text-slate-500">{extra}</p> : null}
    </Link>
  );
}
