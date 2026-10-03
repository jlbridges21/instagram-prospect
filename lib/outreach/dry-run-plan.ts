import { messageAllowedForSequence } from "@/lib/outreach/dm";

export function dryRunPlan(input: {
  username: string;
  profileExists: boolean;
  observedUsername: string | null;
  relationship: string;
  message: string | null;
  followCreatedBySequence?: boolean;
  composerFound?: boolean;
  existingConversation?: boolean;
  composerChecked?: boolean;
}) {
  const observed = input.observedUsername?.replace(/^@/, "").toLowerCase() ?? "";
  const usernameMatches = input.profileExists && observed === input.username.toLowerCase();
  const relationshipKnown = input.relationship === "following" || input.relationship === "not_following" || input.relationship === "requested";
  const followCreatedBySequence = input.followCreatedBySequence === true;
  const followAlreadyCompleted =
    followCreatedBySequence && (input.relationship === "following" || input.relationship === "requested");
  const wouldFollow = input.profileExists && input.relationship === "not_following" && !followAlreadyCompleted;
  const wouldOpenDm =
    usernameMatches &&
    messageAllowedForSequence({
      relationship: input.relationship,
      followCreatedBySequence,
      profileExists: input.profileExists,
      message: input.message,
    });
  const wouldSend = wouldOpenDm && input.existingConversation !== true && input.composerFound !== false;
  return {
    usernameMatches,
    relationshipKnown,
    followCreatedBySequence,
    followAlreadyCompleted,
    wouldFollow,
    wouldOpenDm,
    wouldSend,
    composerFound: input.composerFound === true,
    composerChecked: input.composerChecked === true,
    existingConversation: input.existingConversation === true,
    message: input.message?.trim() || null,
  };
}

export function formatDryRun(input: {
  username: string;
  plan: ReturnType<typeof dryRunPlan>;
  relationship: string;
  profileExists: boolean;
}) {
  const yesNo = (value: boolean) => (value ? "YES" : "NO");
  const lines = [
    `Dry run: @${input.username}`,
    "",
    "Verification",
    `${input.profileExists ? "✓" : "✗"} Profile exists`,
    `${input.plan.usernameMatches ? "✓" : "✗"} Username matches`,
    `✓ Relationship: ${input.relationship}`,
  ];
  if (input.plan.followCreatedBySequence) {
    lines.push("✓ Follow belongs to this outreach sequence");
  }
  lines.push("", "Follow step");
  if (input.plan.followAlreadyCompleted) lines.push("✓ Already completed");
  else lines.push(`Would follow: ${yesNo(input.plan.wouldFollow)}`);
  lines.push("", "Message step");
  if (!input.plan.relationshipKnown) {
    lines.push("Would open DM: not confirmed yet");
    lines.push("Would send: not confirmed yet");
    lines.push("The follow control was not confirmed, so the message step is not assumed.");
  } else {
    lines.push(`Would open DM: ${yesNo(input.plan.wouldOpenDm)}`);
    if (input.plan.composerChecked) {
      lines.push(`Composer: ${input.plan.composerFound ? "found" : "not found"}`);
      lines.push(`Existing conversation: ${input.plan.existingConversation ? "YES" : "NO"}`);
    }
    lines.push(`Would send: ${yesNo(input.plan.wouldSend)}`);
  }
  if (input.plan.message) {
    lines.push("");
    lines.push("Message:");
    lines.push(input.plan.message);
  }
  lines.push("");
  lines.push("No actions were performed.");
  lines.push("No jobs were completed.");
  return lines.join("\n");
}
