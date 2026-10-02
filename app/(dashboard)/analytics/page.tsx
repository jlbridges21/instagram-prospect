import type { Metadata } from "next";
import { FunnelChart } from "@/components/dashboard/metrics";
import { DatabaseSetup } from "@/components/layout/database-setup";
import { PageHeader } from "@/components/layout/page-header";
import { getOutreachAnalytics } from "@/lib/db/outreach";
import { emptyPipeline, getPipelineCounts } from "@/lib/db/stats";
import { fallbackSettings, getSettings } from "@/lib/db/settings";
import { daysAgoIso, formatPercent, rate, startOfTodayIso } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Analytics" };

const ranges = [
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "all", label: "All time" },
] as const;

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const requested = Array.isArray(params.range) ? params.range[0] : params.range;
  const range = ranges.some((item) => item.id === requested) ? requested : "all";
  const settingsResult = await getSettings();
  const settings = settingsResult.ok ? settingsResult.data : fallbackSettings();
  const since = range === "7d" ? daysAgoIso(7) : range === "30d" ? daysAgoIso(30) : null;
  const [pipelineResult, outreach] = await Promise.all([
    getPipelineCounts(startOfTodayIso(settings.timezone), since),
    getOutreachAnalytics(since),
  ]);
  const counts = pipelineResult.ok ? pipelineResult.data : emptyPipeline();

  const rates = [
    {
      label: "Total discovered",
      value: String(counts.discovered),
      detail: "All records",
    },
    {
      label: "Qualification rate",
      value: formatPercent(rate(counts.qualified, counts.discovered)),
      detail: fraction(counts.qualified, counts.discovered, "discovered"),
    },
    {
      label: "Approval rate",
      value: formatPercent(rate(counts.approved, counts.qualified)),
      detail: fraction(counts.approved, counts.qualified, "qualified"),
    },
    {
      label: "Contact rate",
      value: formatPercent(rate(counts.contacted, counts.approved)),
      detail: fraction(counts.contacted, counts.approved, "approved"),
    },
    {
      label: "Reply rate",
      value: formatPercent(rate(counts.replied, counts.contacted)),
      detail: fraction(counts.replied, counts.contacted, "contacted"),
    },
    {
      label: "Demo rate",
      value: formatPercent(rate(counts.demoBooked, counts.contacted)),
      detail: fraction(counts.demoBooked, counts.contacted, "contacted"),
    },
    {
      label: "Conversion rate",
      value: formatPercent(rate(counts.converted, counts.demoBooked)),
      detail: fraction(counts.converted, counts.demoBooked, "demos"),
    },
  ];

  const discovered = Math.max(counts.discovered, 1);

  return (
    <div>
      <PageHeader
        title="Analytics"
        description="Rates use prospect records already in the database."
      />
      <div className="mb-4 flex gap-2">
        {ranges.map((item) => (
          <a
            key={item.id}
            href={item.id === "all" ? "/analytics" : `/analytics?range=${item.id}`}
            className={
              range === item.id
                ? "rounded-lg bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700"
                : "rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
            }
            aria-current={range === item.id ? "page" : undefined}
          >
            {item.label}
          </a>
        ))}
      </div>
      {!pipelineResult.ok && pipelineResult.missingTable ? (
        <div className="mb-6">
          <DatabaseSetup message={pipelineResult.error} />
        </div>
      ) : null}
      {!pipelineResult.ok && !pipelineResult.missingTable ? (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {pipelineResult.error}
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {rates.map((item) => (
          <section key={item.label} className="rounded-xl border border-slate-200 bg-white px-4 py-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{item.label}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-900">{item.value}</p>
            <p className="mt-1 text-xs text-slate-500">{item.detail}</p>
          </section>
        ))}
      </div>
      {outreach ? (
        <section className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-4">
          <h2 className="text-sm font-semibold text-slate-900">Message queue</h2>
          <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <dt className="text-xs text-slate-500">Messages queued</dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums">{outreach.queued}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Messages sent</dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums">{outreach.sent}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Send failures</dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums">{outreach.failed}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Approval to contact</dt>
              <dd className="mt-1 text-lg font-semibold">
                {outreach.averageMs === null ? "—" : formatDuration(outreach.averageMs)}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-slate-500">
            Send success rate {formatPercent(rate(outreach.sent, outreach.sent + outreach.failed))}. Counts come from completed send jobs, not from jobs that were only created.
          </p>
        </section>
      ) : null}
      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900">Funnel</h2>
        <div className="mt-5">
          <FunnelChart
            stages={[
              {
                label: "Discovered",
                count: counts.discovered,
                detail: counts.discovered ? "100%" : "--",
              },
              {
                label: "Qualified",
                count: counts.qualified,
                detail: formatPercent(counts.discovered ? counts.qualified / discovered : null),
              },
              {
                label: "Approved",
                count: counts.approved,
                detail: formatPercent(counts.discovered ? counts.approved / discovered : null),
              },
              {
                label: "Contacted",
                count: counts.contacted,
                detail: formatPercent(counts.discovered ? counts.contacted / discovered : null),
              },
              {
                label: "Replied",
                count: counts.replied,
                detail: formatPercent(counts.discovered ? counts.replied / discovered : null),
              },
              {
                label: "Demo booked",
                count: counts.demoBooked,
                detail: formatPercent(counts.discovered ? counts.demoBooked / discovered : null),
              },
              {
                label: "Converted",
                count: counts.converted,
                detail: formatPercent(counts.discovered ? counts.converted / discovered : null),
              },
            ]}
          />
        </div>
      </section>
    </div>
  );
}

function formatDuration(ms: number) {
  const hours = Math.round(ms / (60 * 60 * 1000));
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function fraction(numerator: number, denominator: number, noun: string) {
  if (denominator <= 0) return "Not enough data";
  return `${numerator} of ${denominator} ${noun}`;
}
