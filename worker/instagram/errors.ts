export class SelectorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SelectorError";
  }
}

export class NavigationError extends Error {
  code = "page_load_failed" as const;

  constructor(message: string) {
    super(message);
    this.name = "NavigationError";
  }
}

export class AttentionError extends Error {
  code: "login_required" | "instagram_checkpoint" | "action_blocked" | "rate_limited";

  constructor(code: AttentionError["code"], message: string) {
    super(message);
    this.name = "AttentionError";
    this.code = code;
  }
}
