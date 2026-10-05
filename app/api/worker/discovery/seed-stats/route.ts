import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { isWorkerAuthorized, workerError, workerUnauthorized } from "@/lib/worker/auth";

const bodySchema = z.object({
  id: z.string().uuid(),
  discovered: z.number().int().min(0).max(50).optional(),
  inspected: z.number().int().min(0).max(5).optional(),
  seen: z.number().int().min(0).max(100).optional(),
  duplicates: z.number().int().min(0).max(50).optional(),
  used: z.boolean().optional(),
});

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isWorkerAuthorized(request)) return workerUnauthorized();
  const admin = createAdminClient();
  if (!admin) return workerError(500, "Worker API is not configured.");
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return workerError(400, "Invalid seed stats.");
  const { error } = await admin.rpc("bump_discovery_seed", {
    p_id: parsed.data.id,
    p_discovered: parsed.data.discovered ?? 0,
    p_inspected: parsed.data.inspected ?? 0,
    p_seen: parsed.data.seen ?? 0,
    p_duplicates: parsed.data.duplicates ?? 0,
    p_used: parsed.data.used ?? false,
  });
  if (error) return Response.json({ ok: true, recorded: false });
  return Response.json({ ok: true, recorded: true });
}
