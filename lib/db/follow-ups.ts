import "server-only";

import { databaseErrorMessage, isMissingRelation } from "@/lib/db/errors";
import type { DataResult } from "@/lib/db/models";
import type { FollowUpRow, ProspectRow } from "@/lib/db/types";
import { createClient } from "@/lib/supabase/server";

export type FollowUpListItem = FollowUpRow & {
  prospects: Pick<
    ProspectRow,
    "id" | "instagram_username" | "display_name" | "first_name" | "status" | "contacted_at"
  > | null;
};

export async function getFollowUps(): Promise<DataResult<FollowUpListItem[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("follow_ups")
    .select(
      "id, prospect_id, due_at, status, notes, created_at, updated_at, completed_at, prospects(id, instagram_username, display_name, first_name, status, contacted_at)",
    )
    .order("due_at", { ascending: true, nullsFirst: false });

  if (error) {
    return {
      ok: false,
      error: databaseErrorMessage(error),
      missingTable: isMissingRelation(error),
    };
  }

  return { ok: true, data: (data ?? []) as FollowUpListItem[] };
}

export async function countFollowUpsDue(endOfToday: string): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("follow_ups")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending")
    .lte("due_at", endOfToday);

  if (error || count === null) return 0;
  return count;
}
