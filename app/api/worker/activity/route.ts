import { z } from "zod";
import { logActivity } from "@/lib/activity/log";
import { ACTIVITY_EVENTS } from "@/lib/constants/prospects";
import type { Json } from "@/lib/db/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { isWorkerAuthorized, workerError, workerUnauthorized } from "@/lib/worker/auth";

export const runtime = "nodejs";

const activitySchema = z.object({
  event_type: z.enum(ACTIVITY_EVENTS),
  description: z.string().trim().min(1).max(500),
  prospect_id: z.string().uuid().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
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

  const parsed = activitySchema.safeParse(body);
  if (!parsed.success) {
    return workerError(400, parsed.error.issues.map((issue) => issue.message).join(" "));
  }

  const logged = await logActivity(admin, {
    prospectId: parsed.data.prospect_id ?? null,
    eventType: parsed.data.event_type,
    description: parsed.data.description,
    metadata: (parsed.data.metadata ?? {}) as Json,
  });

  if (!logged.ok) return workerError(500, "Could not write the activity event.");
  return Response.json({ ok: true });
}
