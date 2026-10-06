import type { Metadata } from "next";
import { MobileProspects } from "@/components/mobile/mobile-prospects";
import { categoryLabel } from "@/lib/ai/categories";
import { DatabaseSetup } from "@/components/layout/database-setup";
import { PageHeader } from "@/components/layout/page-header";
import { ReviewQueue } from "@/components/review/review-queue";
import { getReviewQueue, getReviewTodayCounts } from "@/lib/db/prospects";
import { fallbackSettings, getSettings } from "@/lib/db/settings";
import { formatFollowerCount } from "@/lib/utils/format";
import { prospectMessage } from "@/lib/utils/message";

export const metadata: Metadata = { title: "Review Queue" };

export default async function ReviewPage() {
  const settingsPromise = getSettings();
  const settingsResult = await settingsPromise;
  const settingsForCounts = settingsResult.ok ? settingsResult.data : fallbackSettings();
  const [queueResult, counts] = await Promise.all([
    getReviewQueue(),
    getReviewTodayCounts(settingsForCounts.timezone),
  ]);
  const settings = settingsForCounts;
  const items = queueResult.ok ? queueResult.data : [];

  return (
    <div>
      <MobileProspects
        rows={items.map((prospect) => ({
          id: prospect.id,
          name: prospect.display_name || prospect.first_name || prospect.instagram_username,
          username: prospect.instagram_username,
          followers: formatFollowerCount(prospect.follower_count),
          fitLabel: prospect.fit_label,
          fitScore: prospect.fit_score,
          status: prospect.status,
          reason: prospect.qualification_reason || "No qualification reason stored.",
          category: categoryLabel(prospect.category),
          source: prospect.source ?? "",
          pictureUrl: prospect.profile_picture_url,
          profileUrl: prospect.profile_url || `https://www.instagram.com/${prospect.instagram_username}/`,
          message: prospectMessage({
            template: settings.messageTemplate,
            messageOverride: prospect.message_override,
            firstName: prospect.first_name,
            username: prospect.instagram_username,
          }),
          canRequeue: false,
        }))}
        query={{ q: "", view: "review", status: "all", fit: "all", category: "", source: "", minFollowers: "", maxFollowers: "", sort: "newest", page: 1, pageSize: 25 }}
        counts={{ review: items.length }}
        page={1}
        pageCount={1}
        empty="No prospects are waiting for review."
        title="Review"
        subtitle="Qualified prospects waiting for a decision."
      />
      <div className="hidden md:block">
      <PageHeader
        title="Review Queue"
        description="Qualified prospects waiting for your decision. Approving or skipping updates the database. Messages are not sent."
      />
      {!queueResult.ok && queueResult.missingTable ? <DatabaseSetup message={queueResult.error} /> : null}
      {!queueResult.ok && !queueResult.missingTable ? (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {queueResult.error}
        </div>
      ) : null}
      <ReviewQueue
        analyzedToday={counts.analyzed}
        excludedToday={counts.excluded}
        items={items.map((prospect) => ({
          id: prospect.id,
          name: prospect.display_name || prospect.first_name || prospect.instagram_username,
          username: prospect.instagram_username,
          followers: formatFollowerCount(prospect.follower_count),
          category: categoryLabel(prospect.category),
          location: prospect.location_text || "",
          fitScore: prospect.fit_score,
          fitLabel: prospect.fit_label,
          reason: prospect.qualification_reason || "No qualification reason stored.",
          message: prospectMessage({
            template: settings.messageTemplate,
            messageOverride: prospect.message_override,
            firstName: prospect.first_name,
            username: prospect.instagram_username,
          }),
          profileUrl: prospect.profile_url || `https://www.instagram.com/${prospect.instagram_username}/`,
          postUrl: prospect.instagram_post_url,
          thumbnailUrl: prospect.instagram_post_thumbnail_url,
          pictureUrl: prospect.profile_picture_url,
        }))}
      />
      </div>
    </div>
  );
}
