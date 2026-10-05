import type { Metadata } from "next";
import { DatabaseSetup } from "@/components/layout/database-setup";
import { PageHeader } from "@/components/layout/page-header";
import { ProspectFilters, ProspectPagination } from "@/components/prospects/prospect-filters";
import { LiveProspectSync } from "@/components/prospects/live-sync";
import { ProspectsTable } from "@/components/prospects/prospects-table";
import { SuppressionList } from "@/components/prospects/suppression-list";
import { categoryLabel } from "@/lib/ai/categories";
import {
  pageSizeFromParam,
  SOURCE_LABELS,
  isFitLabel,
  isProspectSort,
  isProspectSource,
  isProspectStatus,
  type ProspectSource,
} from "@/lib/constants/prospects";
import { getProspectOutreachFlags } from "@/lib/db/outreach";
import { getProspectCategories, getProspectPage, getProspectTabCounts, type ProspectQuery } from "@/lib/db/prospects";
import { fallbackSettings, getSettings } from "@/lib/db/settings";
import { formatDate, formatDateTime, formatFollowerCount, parsePositiveInt, readParam } from "@/lib/utils/format";
import { followingBadge } from "@/lib/prospects/following";
import { prospectReason } from "@/lib/prospects/reason";
import { parseProspectTab, prospectTab } from "@/lib/prospects/tabs";
import { prospectWhy } from "@/lib/status/operations";
import { prospectMessage } from "@/lib/utils/message";

function whyLine(row: { status: string; fit_label: string | null; fit_score: number | null; already_following: boolean; qualification_reason?: string | null; qualification_error?: string | null; already_contacted?: boolean; ai_analyzed_at?: string | null; follow_relationship?: string | null }) {
  const why = prospectWhy({
    status: row.status,
    fitLabel: row.fit_label,
    fitScore: row.fit_score,
    reason: prospectReason(row),
    alreadyFollowing: row.already_following,
  });
  return `${why.headline}. ${why.detail}`;
}

export const metadata: Metadata = { title: "Prospects" };
export const maxDuration = 60;

export default async function ProspectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const statusValue = readParam(params, "status");
  const fitValue = readParam(params, "fit");
  const sourceValue = readParam(params, "source");
  const sortValue = readParam(params, "sort");

  const viewValue = readParam(params, "view");
  const view = viewValue === "all" ? "all" : parseProspectTab(viewValue);
  const query: ProspectQuery = {
    q: readParam(params, "q"),
    view,
    status: isProspectStatus(statusValue) ? statusValue : "all",
    fit: isFitLabel(fitValue) ? fitValue : "all",
    category: readParam(params, "category"),
    source: isProspectSource(sourceValue) ? sourceValue : "",
    minFollowers: readParam(params, "min"),
    maxFollowers: readParam(params, "max"),
    sort: isProspectSort(sortValue) ? sortValue : "newest",
    page: parsePositiveInt(readParam(params, "page"), 1),
    pageSize: pageSizeFromParam(readParam(params, "pageSize")),
  };

  const [settingsResult, pageResult, categories, counts] = await Promise.all([
    getSettings(),
    getProspectPage(query),
    getProspectCategories(),
    getProspectTabCounts(),
  ]);
  const settings = settingsResult.ok ? settingsResult.data : fallbackSettings();
  const filtered = Boolean(
    query.q ||
      query.view !== "review" ||
      query.status !== "all" ||
      query.fit !== "all" ||
      query.category ||
      query.source ||
      query.minFollowers ||
      query.maxFollowers,
  );

  const pageRows = pageResult.ok ? pageResult.data.rows : [];
  const outreachFlags = await getProspectOutreachFlags(pageRows.map((row) => row.id));
  const count = pageResult.ok ? pageResult.data.count : 0;
  const pageCount = Math.max(1, Math.ceil(count / query.pageSize));

  return (
    <div>
      <PageHeader
        title="Prospects"
        description={
          pageResult.ok
            ? `${count} profile${count === 1 ? "" : "s"} in the workspace.`
            : "Profiles discovered for outreach."
        }
      />
      {!pageResult.ok && pageResult.missingTable ? (
        <DatabaseSetup message={pageResult.error} />
      ) : null}
      {!pageResult.ok && !pageResult.missingTable ? (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {pageResult.error}
        </div>
      ) : null}
      <LiveProspectSync notice />
      {view === "suppressed" ? <SuppressionList /> : null}
      <ProspectFilters query={query} categories={categories} counts={counts} />
      {view !== "suppressed" && pageRows.length === 0 && pageResult.ok ? (
        <div className="mb-4 rounded-xl border border-slate-200 bg-white px-4 py-8 text-center">
          <p className="text-sm font-medium text-slate-900">{view === "all" ? "No profiles match these filters." : prospectTab(view).empty}</p>
          {view === "review" ? (
            <a href="/discovery" className="mt-3 inline-flex rounded-lg bg-indigo-600 px-3 py-2 text-sm text-white">Start Discovery</a>
          ) : null}
        </div>
      ) : null}
      {view === "suppressed" ? null : <ProspectsTable
        matchCount={count}
        query={query}
        filtered={filtered}
        view={view}
        rows={pageRows.map((row) => ({
          id: row.id,
          name: row.display_name || row.first_name || row.instagram_username,
          username: row.instagram_username,
          category: categoryLabel(row.category),
          followers: formatFollowerCount(row.follower_count),
          following: followingBadge(row),
          fitLabel: row.fit_label,
          fitScore: row.fit_score,
          status: row.status,
          source: SOURCE_LABELS[row.source as ProspectSource] ?? row.source,
          discovered: formatDate(row.discovered_at, settings.timezone, settings.dateFormat),
          profileUrl: row.profile_url || `https://www.instagram.com/${row.instagram_username}/`,
          pictureUrl: row.profile_picture_url,
          reason: whyLine(row),
          message: prospectMessage({
            template: settings.messageTemplate,
            messageOverride: row.message_override,
            firstName: row.first_name,
            username: row.instagram_username,
          }),
          canRequeue: row.status === "approved" && !row.already_contacted && Boolean(outreachFlags.get(row.id)?.canRequeue),
          nextScheduled: outreachFlags.get(row.id)?.nextScheduled
            ? formatDateTime(outreachFlags.get(row.id)?.nextScheduled ?? null, settings.timezone, settings.dateFormat)
            : null,
        }))}
      />}
      <ProspectPagination query={query} page={query.page} pageCount={pageCount} />
    </div>
  );
}
