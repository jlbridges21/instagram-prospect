import { z } from "zod";
import { recheckWorkerRelationship } from "@/lib/prospects/service";
import { createAdminClient } from "@/lib/supabase/admin";
import { isWorkerAuthorized, workerError, workerUnauthorized } from "@/lib/worker/auth";

export const runtime = "nodejs";

const schema = z.object({
  instagram_username: z.string().trim().min(1).max(80),
  follow_relationship: z.enum(["following", "not_following", "requested", "unknown"]),
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
  const parsed = schema.safeParse(body);
  if (!parsed.success) return workerError(400, "Username and relationship are required.");

  const result = await recheckWorkerRelationship(admin, parsed.data);
  if (!result.ok) return workerError(result.status, result.error);
  return Response.json(result);
}
