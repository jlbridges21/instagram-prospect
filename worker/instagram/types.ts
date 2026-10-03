export type DomLink = { href: string; text: string; label?: string; title?: string };
export type DomButton = { name: string; text?: string; label?: string };
export type RelationshipCandidate = {
  tag: string;
  role: string;
  text: string;
  ariaLabel: string;
  title: string;
  href: string;
  tabIndex: string;
  scope: "primary" | "outside";
  besideOptions?: boolean;
  isInteractive?: boolean;
};

export type ElementBox = { x: number; y: number; width: number; height: number };

export type ExactRelationshipHit = {
  label: string;
  tag: string;
  role: string;
  text: string;
  ariaLabel: string;
  title: string;
  href: string;
  tabIndex: string;
  box: ElementBox | null;
  inSuggestion: boolean;
  inDialog: boolean;
  otherUsername: string | null;
  ancestor: {
    tag: string;
    role: string;
    text: string;
    ariaLabel: string;
    href: string;
    box: ElementBox | null;
  } | null;
};
export type DomImage = { alt: string; src: string };
export type DomTextbox = { name: string; value: string };
export type ComposerCandidate = {
  tag: string;
  role: string;
  ariaLabel: string;
  placeholder: string;
  contentEditable: boolean;
  value: string;
  box: { x: number; y: number; width: number; height: number } | null;
  inConversation: boolean;
};
export type MessageActionHit = {
  label: string;
  tag: string;
  role: string;
  text: string;
  ariaLabel: string;
  inSuggestion: boolean;
  inNavigation: boolean;
  inDialog: boolean;
  box: ElementBox | null;
  ancestor: { tag: string; role: string; box: ElementBox | null } | null;
};
export type DomArticle = { text: string; links: DomLink[] };

export type DomSnapshot = {
  url: string;
  title: string;
  bodyText: string;
  links: DomLink[];
  buttons: DomButton[];
  images: DomImage[];
  textboxes: DomTextbox[];
  articles: DomArticle[];
  hasPasswordField: boolean;
  threadMessages: string[];
  bioText: string | null;
  headerLines?: string[];
  headerButtons?: DomButton[];
  relationshipCandidates?: RelationshipCandidate[];
  exactRelationshipHits?: ExactRelationshipHit[];
  messageActionHits?: MessageActionHit[];
  composerCandidates?: ComposerCandidate[];
  conversationHeader?: string;
  recipientCandidates?: Array<{
    text: string;
    href: string;
    role: string;
    ariaLabel: string;
    title: string;
    alt: string;
  }>;
  usernameBox?: ElementBox | null;
  optionsBox?: ElementBox | null;
  metaDescription?: string | null;
  profileIsPrivate?: boolean;
  profileImageUrl?: string | null;
  suggestedProfiles?: Array<{ username: string; href: string }>;
};

export type FeedCandidate = {
  username: string;
  profileUrl: string;
  postUrl: string | null;
};

export type ProfileExtract = {
  username: string | null;
  displayName: string | null;
  bio: string | null;
  followerCount: number | null;
  followingCount: number | null;
  profilePictureUrl: string | null;
  relationship: import("./parse").FollowRelationship;
  locationText: string | null;
  profileIsPrivate: boolean;
  strategies: Record<string, string>;
};

export type PageSignal =
  | "login_required"
  | "instagram_checkpoint"
  | "action_blocked"
  | "rate_limited"
  | "profile_not_found"
  | "dm_unavailable"
  | null;
