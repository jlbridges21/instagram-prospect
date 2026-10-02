import type { AiCategory } from "@/lib/ai/categories";
import type { QualificationAnalysis } from "@/lib/ai/schemas";
import type { FitLabel, ProspectStatus } from "@/lib/constants/prospects";

export type QualificationInput = {
  instagramUsername: string;
  displayName: string | null;
  firstName: string | null;
  bio: string | null;
  followerCount: number | null;
  followingCount: number | null;
  locationText: string | null;
  language: string | null;
  category: string | null;
  alreadyFollowing: boolean;
  alreadyContacted: boolean;
  instagramPostUrl: string | null;
  notes: string | null;
  sourceContext?: string | null;
};

export type QualificationRules = {
  minFollowers: number;
  maxFollowers: number;
  englishOnly: boolean;
  preferUnitedStates: boolean;
  allowUnknownLocation: boolean;
  excludeAlreadyFollowing: boolean;
  excludeAlreadyContacted: boolean;
  excludeHobbyAccounts: boolean;
  excludeMemeAccounts: boolean;
  excludeLargeAgencies: boolean;
  excludeUnrelatedDrone: boolean;
  strongFitMinimum: number;
  possibleFitMinimum: number;
  categories: string[];
};

export type QualificationDecision = {
  analysis: QualificationAnalysis;
  fitScore: number;
  fitLabel: FitLabel;
  category: AiCategory | null;
  qualified: boolean;
  status: Extract<ProspectStatus, "review" | "disqualified">;
  firstName: string | null;
  language: string | null;
  calledModel: boolean;
  inputTokens: number | null;
  outputTokens: number | null;
};
