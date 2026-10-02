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
};
export type DomImage = { alt: string; src: string };
export type DomTextbox = { name: string; value: string };
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
  metaDescription?: string | null;
  profileIsPrivate?: boolean;
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
