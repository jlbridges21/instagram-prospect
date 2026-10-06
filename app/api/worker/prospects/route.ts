import { z } from "zod";
import { PROSPECT_SOURCES } from "@/lib/constants/prospects";
import { ingestWorkerProspect } from "@/lib/prospects/service";
import { createAdminClient } from "@/lib/supabase/admin";
import { isWorkerAuthorized, workerError, workerUnauthorized } from "@/lib/worker/auth";

export const runtime = "nodejs";

const prospectSchema = z.object({
  instagram_username: z.string().trim().min(1).max(80),
  display_name: z.string().trim().max(200).nullable().optional(),
  first_name: z.string().trim().max(80).nullable().optional(),
  profile_url: z.string().trim().max(500).nullable().optional(),
  profile_picture_url: z.string().trim().max(1000).nullable().optional(),
  bio: z.string().trim().max(2200).nullable().optional(),
  follower_count: z.number().int().min(0).max(100_000_000).nullable().optional(),
  following_count: z.number().int().min(0).max(100_000_000).nullable().optional(),
  location_text: z.string().trim().max(200).nullable().optional(),
  language: z.string().trim().max(40).nullable().optional(),
  already_following: z.boolean().optional(),
  instagram_post_url: z.string().trim().max(500).nullable().optional(),
  instagram_post_thumbnail_url: z.string().trim().max(1000).nullable().optional(),
  source: z.enum(PROSPECT_SOURCES).optional(),
  source_seed_id: z.string().uuid().nullable().optional(),
  source_seed_username: z.string().trim().max(30).nullable().optional(),
  discovery_priority_label: z.string().trim().max(20).nullable().optional(),
  discovery_priority_reason: z.string().trim().max(500).nullable().optional(),
  discovery_pre_score: z.number().int().min(0).max(100).nullable().optional(),
  follow_relationship: z.enum(["following", "not_following", "requested", "unknown"]).optional(),
});

export async function POST(request: Request) {
  if (!isWorkerAuthorized(request)) return workerUnauthorized();

  const admin = createAdminClient();
  if (!admin) return workerError(500, "Worker API is not configured.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return workerError(400, "Request body must be JSON.");
  }

  const parsed = prospectSchema.safeParse(body);
  if (!parsed.success) {
    return workerError(400, parsed.error.issues.map((issue) => issue.message).join(" "));
  }

  const result = await ingestWorkerProspect(admin, parsed.data);
  if (!result.ok) return workerError(result.status, result.error);

  return Response.json({
    created: result.created,
    reason: result.created ? undefined : result.reason,
    prospectId: result.prospectId,
    queued: result.queued,
    status: result.created ? result.status : undefined,
    shouldQualify: "shouldQualify" in result ? result.shouldQualify : false,
  });
}
