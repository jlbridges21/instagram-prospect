import { failJob } from "@/lib/outreach/service";
import { failJobSchema } from "@/lib/outreach/schemas";
import { createAdminClient } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/utils/format";
import { isWorkerAuthorized, workerError, workerUnauthorized } from "@/lib/worker/auth";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isWorkerAuthorized(request)) return workerUnauthorized();
  const { id } = await params;
  if (!isUuid(id)) return workerError(400, "That job could not be found.");

  const admin = createAdminClient();
  if (!admin) return workerError(500, "Worker API is not configured.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return workerError(400, "Request body must be JSON.");
  }
  const parsed = failJobSchema.safeParse(body);
  if (!parsed.success) return workerError(400, "A worker id, error code, and short error message are required.");

  const result = await failJob({
    admin,
    jobId: id,
    workerId: parsed.data.worker_id,
    errorCode: parsed.data.error_code,
    errorMessage: parsed.data.error_message,
    retryable: parsed.data.retryable,
  });
  if (!result.ok) {
    const status = "status" in result && typeof result.status === "number" ? result.status : 500;
    return workerError(status, result.error);
  }
  return Response.json({ ok: true, status: result.status, attemptCount: result.attemptCount });
}
