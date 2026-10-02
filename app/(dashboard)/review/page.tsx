import type { Metadata } from "next";
import { categoryLabel } from "@/lib/ai/categories";
import { DatabaseSetup } from "@/components/layout/database-setup";
import { PageHeader } from "@/components/layout/page-header";
import { ReviewQueue } from "@/components/review/review-queue";
import { getReviewQueue } from "@/lib/db/prospects";
import { fallbackSettings, getSettings } from "@/lib/db/settings";
import { formatFollowerCount } from "@/lib/utils/format";
import { prospectMessage } from "@/lib/utils/message";

export const metadata: Metadata = { title: "Review Queue" };

export default async function ReviewPage() {
  const [queueResult, settingsResult] = await Promise.all([getReviewQueue(), getSettings()]);
  const settings = settingsResult.ok ? settingsResult.data : fallbackSettings();
  const items = queueResult.ok ? queueResult.data : [];

  return (
    <div>
      <PageHeader
        title="Review queue"
        description="Decide who is approved. Approving and skipping update the database. Messages are not sent."
      />
      {!queueResult.ok && queueResult.missingTable ? <DatabaseSetup message={queueResult.error} /> : null}
      {!queueResult.ok && !queueResult.missingTable ? (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {queueResult.error}
        </div>
      ) : null}
      <ReviewQueue
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
  );
}
