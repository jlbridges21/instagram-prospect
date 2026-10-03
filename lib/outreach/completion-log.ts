export function prospectCompletionLine(input: {
  username: string | null;
  jobType: string;
  sequenceComplete: boolean;
}) {
  if (!input.sequenceComplete || input.jobType !== "send_message" || !input.username) return null;
  return `Completed outreach for @${input.username}.`;
}
