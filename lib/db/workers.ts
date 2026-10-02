import "server-only";

import { databaseErrorMessage, isMissingRelation } from "@/lib/db/errors";
import type { DataResult } from "@/lib/db/models";
import type { WorkerInstanceRow } from "@/lib/db/types";
import { createClient } from "@/lib/supabase/server";

export async function getLatestWorker(): Promise<DataResult<WorkerInstanceRow | null>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("worker_instances")
    .select("*")
    .order("last_heartbeat_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      error: databaseErrorMessage(error),
      missingTable: isMissingRelation(error),
    };
  }

  return { ok: true, data };
}
