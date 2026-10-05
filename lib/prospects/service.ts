import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { logActivities } from "@/lib/activity/log";
import type { ActivityEventType, ProspectSource, ProspectStatus } from "@/lib/constants/prospects";
import type { Database, Json } from "@/lib/db/types";
import { preAiStorage } from "@/lib/discovery/policy";
import { isMissingRelation } from "@/lib/db/errors";
import { canApprove, canSkip } from "@/lib/prospects/status";
import { normalizeUsername, profileUrlForUsername } from "@/lib/utils/format";

type Client = SupabaseClient<Database>;

export type ManualProspectInput = {
  instagramUsername: string;
  displayName: string;
  firstName: string;
  profileUrl: string;
  profilePictureUrl: string;
  bio: string;
  followerCount: string;
  followingCount: string;
  location: string;
  language: string;
  category: string;
  fitScore: string;
  qualificationReason: string;
  sourcePostUrl: string;
  sourcePostThumbnailUrl: string;
  notes: string;
};

const USERNAME_PATTERN = /^[a-z0-9._]{1,30}$/;

function blank(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function countOrNull(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return { ok: true as const, value: null };
  if (!/^\d+$/.test(trimmed)) return { ok: false as const, error: "Follower counts must be whole numbers." };
  return { ok: true as const, value: Number.parseInt(trimmed, 10) };
}

function timestampPatch(status: "approved" | "skipped", now: string) {
  if (status === "approved") {
    return { status, approved_at: now, last_status_changed_at: now };
  }
  return { status: "skipped" as const, last_status_changed_at: now };
}

export async function changeProspectStatus(
  supabase: Client,
  input: {
    ids: string[];
    status: "approved" | "skipped";
    actor: string;
  },
) {
  const uniqueIds = [...new Set(input.ids)];
  const now = new Date().toISOString();
  const allowed = input.status === "approved" ? canApprove : canSkip;
  const updated: { id: string; instagram_username: string }[] = [];

  for (let index = 0; index < uniqueIds.length; index += 100) {
    const chunk = uniqueIds.slice(index, index + 100);
    const { data: current, error: readError } = await supabase
      .from("prospects")
      .select("id, status")
      .in("id", chunk);

    if (readError) return { ok: false as const, error: readError.message, updated };

    const eligible = (current ?? [])
      .filter((row) => allowed(row.status))
      .map((row) => row.id);
    if (eligible.length === 0) continue;

    const { data, error } = await supabase
      .from("prospects")
      .update(timestampPatch(input.status, now))
      .in("id", eligible)
      .select("id, instagram_username");

    if (error) return { ok: false as const, error: error.message, updated };
    updated.push(...(data ?? []));
  }

  if (updated.length === 0) {
    return {
      ok: false as const,
      error:
        input.status === "approved"
          ? "None of the selected prospects can be approved."
          : "None of the selected prospects can be skipped.",
      updated,
    };
  }

  const eventType: ActivityEventType =
    input.status === "approved" ? "prospect_approved" : "prospect_skipped";

  const logged = await logActivities(
    supabase,
    updated.map((prospect) => ({
      prospectId: prospect.id,
      eventType,
      description:
        input.status === "approved"
          ? `Approved @${prospect.instagram_username} for outreach.`
          : `Skipped @${prospect.instagram_username}.`,
      metadata: { actor: input.actor },
    })),
  );

  const missed = uniqueIds.length - updated.length;
  const message =
    missed > 0
      ? `Updated ${updated.length} of ${uniqueIds.length}. ${missed} were no longer eligible.`
      : undefined;

  if (!logged.ok) {
    return {
      ok: true as const,
      updated,
      message: message ?? "Status updated. The activity log could not be written.",
    };
  }

  return { ok: true as const, updated, message };
}

export async function createManualProspect(
  supabase: Client,
  input: ManualProspectInput,
  actor: string,
) {
  const username = normalizeUsername(input.instagramUsername);
  if (!USERNAME_PATTERN.test(username)) {
    return {
      ok: false as const,
      error: "Username can use letters, numbers, periods, and underscores.",
    };
  }

  const followers = countOrNull(input.followerCount);
  if (!followers.ok) return followers;
  const following = countOrNull(input.followingCount);
  if (!following.ok) return following;

  let fitScore: number | null = null;
  const fitText = input.fitScore.trim();
  if (fitText) {
    const parsed = Number.parseInt(fitText, 10);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
      return { ok: false as const, error: "Fit score must be a whole number from 0 to 100." };
    }
    fitScore = parsed;
  }

  const fitLabel =
    fitScore === null ? null : fitScore >= 80 ? "strong_fit" : fitScore >= 50 ? "possible_fit" : "skip";

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("prospects")
    .insert({
      instagram_username: username,
      display_name: blank(input.displayName),
      first_name: blank(input.firstName),
      profile_url: profileUrlForUsername(username, input.profileUrl),
      profile_picture_url: blank(input.profilePictureUrl),
      bio: blank(input.bio),
      follower_count: followers.value,
      following_count: following.value,
      location_text: blank(input.location),
      language: blank(input.language),
      category: blank(input.category),
      fit_score: fitScore,
      fit_label: fitLabel,
      qualification_reason: blank(input.qualificationReason),
      qualified: fitScore !== null && fitScore >= 50,
      already_following: false,
      already_contacted: false,
      status: "review",
      notes: blank(input.notes),
      source: "manual" satisfies ProspectSource,
      instagram_post_url: blank(input.sourcePostUrl),
      instagram_post_thumbnail_url: blank(input.sourcePostThumbnailUrl),
      discovered_at: now,
      last_status_changed_at: now,
      is_sample: false,
    })
    .select("id, instagram_username")
    .single();

  if (error) {
    if (error.code === "23505") {
      return {
        ok: false as const,
        error: `@${username} is already in the workspace.`,
      };
    }
    return { ok: false as const, error: error.message };
  }

  await logActivities(supabase, [
    {
      prospectId: data.id,
      eventType: "prospect_discovered",
      description: `Added @${data.instagram_username} manually.`,
      metadata: { actor, source: "manual" },
    },
  ]);

  return { ok: true as const, id: data.id, username: data.instagram_username };
}

export async function saveMessageOverride(
  supabase: Client,
  id: string,
  override: string | null,
) {
  const { error } = await supabase
    .from("prospects")
    .update({ message_override: override })
    .eq("id", id);

  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const };
}

export type WorkerProspectInput = {
  instagram_username: string;
  display_name?: string | null;
  first_name?: string | null;
  profile_url?: string | null;
  profile_picture_url?: string | null;
  bio?: string | null;
  follower_count?: number | null;
  following_count?: number | null;
  location_text?: string | null;
  language?: string | null;
  already_following?: boolean;
  instagram_post_url?: string | null;
  instagram_post_thumbnail_url?: string | null;
  source?: ProspectSource;
  source_seed_id?: string | null;
  source_seed_username?: string | null;
  discovery_priority_label?: string | null;
  discovery_priority_reason?: string | null;
  follow_relationship?: "following" | "not_following" | "requested" | "unknown";
};

export async function ingestWorkerProspect(supabase: Client, input: WorkerProspectInput) {
  const username = normalizeUsername(input.instagram_username);
  if (!USERNAME_PATTERN.test(username)) {
    return { ok: false as const, status: 400, error: "Username is not valid." };
  }

  const { data: existing, error: existingError } = await supabase
    .from("prospects")
    .select("id")
    .eq("instagram_username", username)
    .maybeSingle();

  if (existingError) return { ok: false as const, status: 500, error: "Could not check for an existing prospect." };
  if (existing) {
    return {
      ok: true as const,
      created: false as const,
      reason: "duplicate" as const,
      prospectId: existing.id,
      queued: false,
      shouldQualify: false,
    };
  }

  const following = Boolean(input.already_following);
  const relationship = input.follow_relationship ?? (following ? "following" : "unknown");
  const limits = await followerLimits(supabase);
  const storage = preAiStorage({
    relationship,
    followers: input.follower_count ?? null,
    minFollowers: limits.min,
    maxFollowers: limits.max,
  });
  if (storage.path === "suppression") {
    const suppressed = await rememberSuppression(supabase, {
      username,
      reason: storage.reason,
      permanent: storage.permanent,
      expiresInDays: storage.expiresInDays,
      relationship,
      source: input.source ?? null,
    });
    if (suppressed.ok) {
      return {
        ok: true as const,
        created: false as const,
        reason: "suppressed" as const,
        prospectId: null,
        queued: false,
        shouldQualify: false,
      };
    }
  }
  const relationshipUnknown = input.follow_relationship === "unknown" && !following;
  const status: ProspectStatus = following ? "disqualified" : "discovered";
  const qualificationReason = following
    ? "Already following this account."
    : relationshipUnknown
      ? "Follow status unknown."
      : null;
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("prospects")
    .insert({
      instagram_username: username,
      display_name: input.display_name ?? null,
      first_name: input.first_name ?? null,
      profile_url: profileUrlForUsername(username, input.profile_url),
      profile_picture_url: input.profile_picture_url ?? null,
      bio: input.bio ?? null,
      follower_count: input.follower_count ?? null,
      following_count: input.following_count ?? null,
      location_text: input.location_text ?? null,
      language: input.language ?? null,
      already_following: following,
      already_contacted: false,
      qualified: false,
      status,
      source: input.source ?? "home_feed",
      source_seed_id: input.source_seed_id ?? null,
      source_seed_username: input.source_seed_username ?? null,
      discovery_priority_label: input.discovery_priority_label ?? null,
      discovery_priority_reason: input.discovery_priority_reason ?? null,
      instagram_post_url: input.instagram_post_url ?? null,
      instagram_post_thumbnail_url: input.instagram_post_thumbnail_url ?? null,
      qualification_reason: qualificationReason,
      follow_relationship: input.follow_relationship ?? (following ? "following" : "unknown"),
      discovered_at: now,
      last_status_changed_at: now,
      is_sample: false,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      const { data: raced } = await supabase
        .from("prospects")
        .select("id")
        .eq("instagram_username", username)
        .maybeSingle();
      if (raced) {
        return {
          ok: true as const,
          created: false as const,
          reason: "duplicate" as const,
        prospectId: raced.id,
        queued: false,
        shouldQualify: false,
      };
      }
    }
    console.error("Worker prospect insert failed:", error.message);
    return { ok: false as const, status: 500, error: "Could not store the prospect." };
  }

  const events: {
    prospectId: string;
    eventType: ActivityEventType;
    description: string;
    metadata: Json;
  }[] = [
    {
      prospectId: data.id,
      eventType: "prospect_discovered",
      description: `Discovered @${username} from ${sourceLabel(input.source)}.`,
      metadata: { source: input.source ?? "home_feed", actor: "worker" },
    },
  ];

  if (following) {
    events.push({
      prospectId: data.id,
      eventType: "prospect_disqualified",
      description: `Skipped @${username} because you already follow this account.`,
      metadata: { actor: "worker", reason: "already_following" },
    });
  }

  await logActivities(supabase, events);

  return {
    ok: true as const,
    created: true as const,
    prospectId: data.id,
    queued: false,
    status,
    shouldQualify: relationship === "not_following" && !following,
  };
}

async function followerLimits(supabase: Client) {
  const { data } = await supabase.from("targeting_settings").select("min_followers, max_followers").eq("id", 1).maybeSingle();
  return { min: data?.min_followers ?? 500, max: data?.max_followers ?? 250000 };
}

async function rememberSuppression(
  supabase: Client,
  input: {
    username: string;
    reason: string;
    permanent: boolean;
    expiresInDays: number | null;
    relationship: string;
    source: string | null;
  },
) {
  const now = new Date();
  const expiresAt = input.permanent || input.expiresInDays == null
    ? null
    : new Date(now.getTime() + input.expiresInDays * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await supabase.from("discovery_suppressions").upsert(
    {
      instagram_username_normalized: input.username,
      reason: input.reason,
      follow_relationship: input.relationship,
      source: input.source,
      last_seen_at: now.toISOString(),
      expires_at: expiresAt,
      permanent: input.permanent,
      updated_at: now.toISOString(),
    },
    { onConflict: "instagram_username_normalized" },
  );
  if (error && isMissingRelation(error)) return { ok: false as const };
  if (error) return { ok: false as const };
  return { ok: true as const };
}

function sourceLabel(source: ProspectSource | undefined) {
  if (source === "suggested_accounts") return "Suggested accounts";
  if (source === "seed_suggestion") return "a Discovery Seed";
  if (source === "manual") return "manual entry";
  return "Home feed";
}

export async function recheckWorkerRelationship(
  supabase: Client,
  input: { instagram_username: string; follow_relationship: "following" | "not_following" | "requested" | "unknown" },
) {
  const username = normalizeUsername(input.instagram_username);
  const { data: prospect, error } = await supabase
    .from("prospects")
    .select("id, status, qualification_reason, already_following")
    .eq("instagram_username", username)
    .maybeSingle();
  if (error) return { ok: false as const, status: 500, error: "Could not read the prospect." };
  if (!prospect) return { ok: false as const, status: 404, error: `@${username} is not in the prospect list.` };

  const relationship = input.follow_relationship;
  if (relationship !== "following" && relationship !== "requested") {
    return {
      ok: true as const,
      applied: false,
      relationship,
      reason: "Only a following or requested result can be saved. A not-following result is not written automatically.",
    };
  }

  const locked = ["review", "qualified", "approved", "contacted", "replied", "follow_up", "demo_booked", "converted"].includes(
    prospect.status,
  );
  if (locked) {
    return {
      ok: true as const,
      applied: false,
      relationship,
      reason: `Left @${username} unchanged because its status is ${prospect.status}.`,
    };
  }

  const now = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("prospects")
    .update({
      already_following: true,
      status: "disqualified",
      qualified: false,
      qualification_reason: "Already following this account.",
      last_status_changed_at: now,
    })
    .eq("id", prospect.id);
  if (updateError) return { ok: false as const, status: 500, error: "Could not update the prospect." };

  await logActivities(supabase, [
    {
      prospectId: prospect.id,
      eventType: "prospect_disqualified",
      description: `Skipped @${username} because you already follow this account.`,
      metadata: { actor: "worker", reason: "recheck", relationship },
    },
  ]);

  return { ok: true as const, applied: true, relationship, prospectId: prospect.id };
}
