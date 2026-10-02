import "server-only";

import { databaseErrorMessage, isMissingRelation } from "@/lib/db/errors";
import type { DataResult } from "@/lib/db/models";
import type { WorkerInstanceRow } from "@/lib/db/types";
import { createClient } from "@/lib/supabase/server";

export async function getLatestWorker(): Promise<DataResult<WorkerInstanceRow | null>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("worker_instances")
    .select("id, worker_id, machine_name, platform, hostname, status, current_task, browser_connected, instagram_authenticated, last_heartbeat_at, started_at, attention_reason, profiles_seen, profiles_ingested, profiles_excluded_following, profiles_qualified, session_errors, current_username, last_event, created_at, updated_at")
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
