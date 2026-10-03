export function dryRunPlan(input: {
  username: string;
  profileExists: boolean;
  observedUsername: string | null;
  relationship: string;
  message: string | null;
}) {
  const observed = input.observedUsername?.replace(/^@/, "").toLowerCase() ?? "";
  const usernameMatches = input.profileExists && observed === input.username.toLowerCase();
  const relationshipKnown = input.relationship === "following" || input.relationship === "not_following" || input.relationship === "requested";
  const wouldFollow = input.profileExists && input.relationship === "not_following";
  const wouldOpenDm = wouldFollow && Boolean(input.message?.trim());
  const wouldSend = wouldOpenDm;
  return {
    usernameMatches,
    relationshipKnown,
    wouldFollow,
    wouldOpenDm,
    wouldSend,
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
    "",
    "Follow step",
    `Would follow: ${yesNo(input.plan.wouldFollow)}`,
    "",
    "Message step",
  ];
  if (!input.plan.relationshipKnown) {
    lines.push("Would open DM: not confirmed yet");
    lines.push("Would send: not confirmed yet");
    lines.push("The follow control was not confirmed, so the message step is not assumed.");
  } else {
    lines.push(`Would open DM: ${yesNo(input.plan.wouldOpenDm)}`);
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
