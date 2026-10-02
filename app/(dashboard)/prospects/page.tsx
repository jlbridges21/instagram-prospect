import type { Metadata } from "next";
import { AddProspectButton } from "@/components/prospects/add-prospect-dialog";
import { DatabaseSetup } from "@/components/layout/database-setup";
import { PageHeader } from "@/components/layout/page-header";
import { ProspectFilters, ProspectPagination } from "@/components/prospects/prospect-filters";
import { ProspectsTable } from "@/components/prospects/prospects-table";
import {
  PAGE_SIZE,
  SOURCE_LABELS,
  isFitLabel,
  isProspectSort,
  isProspectSource,
  isProspectStatus,
  type ProspectSource,
} from "@/lib/constants/prospects";
import { getProspectCategories, getProspectPage, type ProspectQuery } from "@/lib/db/prospects";
import { fallbackSettings, getSettings } from "@/lib/db/settings";
import { formatDate, formatFollowerCount, parsePositiveInt, readParam } from "@/lib/utils/format";
import { prospectMessage } from "@/lib/utils/message";

export const metadata: Metadata = { title: "Prospects" };

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

  const query: ProspectQuery = {
    q: readParam(params, "q"),
    status: isProspectStatus(statusValue) ? statusValue : "all",
    fit: isFitLabel(fitValue) ? fitValue : "all",
    category: readParam(params, "category"),
    source: isProspectSource(sourceValue) ? sourceValue : "",
    minFollowers: readParam(params, "min"),
    maxFollowers: readParam(params, "max"),
    sort: isProspectSort(sortValue) ? sortValue : "newest",
    page: parsePositiveInt(readParam(params, "page"), 1),
  };

  const [settingsResult, pageResult, categories] = await Promise.all([
    getSettings(),
    getProspectPage(query),
    getProspectCategories(),
  ]);
  const settings = settingsResult.ok ? settingsResult.data : fallbackSettings();
  const filtered = Boolean(
    query.q ||
      query.status !== "all" ||
      query.fit !== "all" ||
      query.category ||
      query.source ||
      query.minFollowers ||
      query.maxFollowers,
  );

  const count = pageResult.ok ? pageResult.data.count : 0;
  const pageCount = Math.max(1, Math.ceil(count / PAGE_SIZE));

  return (
    <div>
      <PageHeader
        title="Prospects"
        description={
          pageResult.ok
            ? `${count} profile${count === 1 ? "" : "s"} in the workspace.`
            : "Profiles discovered for outreach."
        }
        action={<AddProspectButton />}
      />
      {!pageResult.ok && pageResult.missingTable ? (
        <DatabaseSetup message={pageResult.error} />
      ) : null}
      {!pageResult.ok && !pageResult.missingTable ? (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {pageResult.error}
        </div>
      ) : null}
      <ProspectFilters query={query} categories={categories} />
      <ProspectsTable
        filtered={filtered}
        rows={(pageResult.ok ? pageResult.data.rows : []).map((row) => ({
          id: row.id,
          name: row.display_name || row.first_name || row.instagram_username,
          username: row.instagram_username,
          category: row.category || "Uncategorized",
          followers: formatFollowerCount(row.follower_count),
          fitLabel: row.fit_label,
          fitScore: row.fit_score,
          status: row.status,
          source: SOURCE_LABELS[row.source as ProspectSource] ?? row.source,
          discovered: formatDate(row.discovered_at, settings.timezone, settings.dateFormat),
          profileUrl: row.profile_url || `https://www.instagram.com/${row.instagram_username}/`,
          pictureUrl: row.profile_picture_url,
          message: prospectMessage({
            template: settings.messageTemplate,
            messageOverride: row.message_override,
            firstName: row.first_name,
            username: row.instagram_username,
          }),
        }))}
      />
      <ProspectPagination query={query} page={query.page} pageCount={pageCount} />
    </div>
  );
}
