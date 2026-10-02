import { MESSAGE_NAME_TOKEN } from "@/lib/constants/message";

export function outreachName(input: {
  firstName: string | null;
  username: string;
}) {
  const firstName = input.firstName?.trim();
  if (firstName) return firstName;
  return input.username;
}

export function renderOutreachMessage(
  template: string,
  input: { firstName: string | null; username: string },
) {
  return template.replaceAll(MESSAGE_NAME_TOKEN, outreachName(input));
}

export function prospectMessage(input: {
  template: string;
  messageOverride?: string | null;
  firstName: string | null;
  username: string;
}) {
  const override = input.messageOverride?.trim();
  if (override) return override;
  return renderOutreachMessage(input.template, {
    firstName: input.firstName,
    username: input.username,
  });
}
