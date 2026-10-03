"use server";

import { revalidatePath } from "next/cache";
import { fillReviewDecision } from "@/lib/discovery/policy";
import type { ActionResult } from "@/lib/actions/prospects";
import { requireUser } from "@/lib/supabase/auth";

export async function fillReview(target: number): Promise<ActionResult> {
  if (!Number.isInteger(target) || target < 1 || target > 5000) {
    return { ok: false, error: "Choose a review target between 1 and 5000." };
  }
  const { supabase } = await requireUser();
  const review = await supabase
    .from("prospects")
    .select("id", { count: "exact", head: true })
    .eq("status", "review")
    .in("fit_label", ["strong_fit", "possible_fit"])
    .eq("is_sample", false);
  const current = review.count ?? 0;
  const decision = fillReviewDecision(current, target);
  if (!decision.start) return { ok: true, message: decision.message };

  const { error } = await supabase
    .from("settings")
    .update({
      discovery_review_target: target,
      discovery_enabled: true,
      discovery_auto_paused: false,
      discovery_stop_reason: null,
    })
    .eq("id", 1);
  if (error) {
    if (/discovery_review_target/i.test(error.message)) {
      return { ok: false, error: "Run the Discovery V3 database migration, then try again." };
    }
    return { ok: false, error: error.message };
  }

  await supabase
    .from("discovery_sessions")
    .update({ stopped_at: new Date().toISOString(), stop_reason: "manual_pause" })
    .is("stopped_at", null);
  await supabase.from("discovery_sessions").insert({
    starting_review_count: current,
    target,
  });

  revalidatePath("/");
  revalidatePath("/prospects");
  revalidatePath("/worker");
  revalidatePath("/settings");
  return { ok: true, message: `Discovery is on. Review target is ${target}. Outreach was not changed.` };
}
