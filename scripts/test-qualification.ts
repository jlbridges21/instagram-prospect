import { fallbackTargeting } from "./qualification-fixtures";
import { loadLocalEnv } from "./load-env";
import {
  DEFAULT_POSSIBLE_FIT_MINIMUM,
  DEFAULT_STRONG_FIT_MINIMUM,
  QUALIFICATION_MODEL,
} from "@/lib/ai/config";
import { evaluateProspect } from "@/lib/ai/evaluate";
import { rulesFromTargeting } from "@/lib/ai/openai";
import type { QualificationInput } from "@/lib/ai/types";

loadLocalEnv();

const targeting = fallbackTargeting();
const rules = rulesFromTargeting(targeting, {
  strongFitMinimum: DEFAULT_STRONG_FIT_MINIMUM,
  possibleFitMinimum: DEFAULT_POSSIBLE_FIT_MINIMUM,
});

type Expectation = {
  name: string;
  input: QualificationInput;
  needsModel: boolean;
  assert: (result: Awaited<ReturnType<typeof evaluateProspect>>) => string | null;
};

const base = {
  followingCount: 400,
  language: "en",
  category: null,
  alreadyFollowing: false,
  alreadyContacted: false,
  instagramPostUrl: null,
  notes: null,
  firstName: null,
} satisfies Partial<QualificationInput>;

const cases: Expectation[] = [
  {
    name: "A professional drone photographer",
    needsModel: true,
    input: {
      ...base,
      instagramUsername: "maya.chen.aerial",
      displayName: "Maya Chen Aerial",
      firstName: "Maya",
      bio: "FAA Part 107 drone photographer. Paid real estate and commercial aerials in Austin, Texas.",
      followerCount: 5000,
      locationText: "Austin, TX",
    },
    assert: (result) =>
      result.ok && result.decision.fitLabel === "strong_fit" ? null : "expected strong_fit",
  },
  {
    name: "B real estate media company",
    needsModel: true,
    input: {
      ...base,
      instagramUsername: "northlinemedia",
      displayName: "Northline Media",
      bio: "Real estate photo, video, and aerial media for listing teams across the United States.",
      followerCount: 20000,
      locationText: "Denver, CO",
    },
    assert: (result) =>
      result.ok && result.decision.fitLabel === "strong_fit" ? null : "expected strong_fit",
  },
  {
    name: "C commercial videographer",
    needsModel: true,
    input: {
      ...base,
      instagramUsername: "jordanhale.video",
      displayName: "Jordan Hale Video",
      bio: "Commercial videographer for builders and real estate teams. Based in Nashville.",
      followerCount: 1200,
      locationText: "Nashville, TN",
    },
    assert: (result) =>
      result.ok && result.decision.qualified ? null : "expected a qualifying fit",
  },
  {
    name: "D drone hobbyist",
    needsModel: true,
    input: {
      ...base,
      instagramUsername: "samfliesdrones",
      displayName: "Sam Flies Drones",
      bio: "Weekend hobby flying and sunset clips. Not a business.",
      followerCount: 1800,
      locationText: "Ohio",
    },
    assert: (result) => (result.ok && result.decision.fitLabel === "skip" ? null : "expected skip"),
  },
  {
    name: "E drone meme page",
    needsModel: true,
    input: {
      ...base,
      instagramUsername: "dronememesdaily",
      displayName: "Drone Memes Daily",
      bio: "Daily drone memes. Not a service.",
      followerCount: 90000,
      locationText: "United States",
    },
    assert: (result) => (result.ok && result.decision.fitLabel === "skip" ? null : "expected skip"),
  },
  {
    name: "F real estate agent",
    needsModel: true,
    input: {
      ...base,
      instagramUsername: "listingwithamy",
      displayName: "Amy Brooks Realtor",
      bio: "Realtor sharing new listings and open houses in Dallas. I do not shoot photo or video.",
      followerCount: 8000,
      locationText: "Dallas, TX",
    },
    assert: (result) => (result.ok && result.decision.fitLabel === "skip" ? null : "expected skip"),
  },
  {
    name: "G unknown location stays eligible",
    needsModel: true,
    input: {
      ...base,
      instagramUsername: "harborcomedia",
      displayName: "Harbor Co Media",
      bio: "Photo and video production for small businesses and property marketers.",
      followerCount: 6400,
      locationText: null,
    },
    assert: (result) => {
      if (!result.ok) return "call failed";
      if (!result.decision.qualified) return "expected to remain eligible";
      if (result.decision.analysis.us_based_likely === false) return "unknown location became false";
      return null;
    },
  },
  {
    name: "H non-English media account",
    needsModel: true,
    input: {
      ...base,
      instagramUsername: "estudio.aereo",
      displayName: "Estudio Aéreo",
      bio: "Fotografía aérea y video para inmobiliarias. Trabajamos solo en español.",
      followerCount: 7000,
      locationText: "Ciudad de México",
      language: "es",
    },
    assert: (result) => (result.ok && result.decision.fitLabel === "skip" ? null : "expected skip"),
  },
  {
    name: "I already following",
    needsModel: false,
    input: {
      ...base,
      instagramUsername: "already.followed",
      displayName: "Already Followed Media",
      bio: "Real estate photographer in Austin.",
      followerCount: 4000,
      locationText: "Austin, TX",
      alreadyFollowing: true,
    },
    assert: (result) => {
      if (!result.ok) return "call failed";
      if (result.decision.calledModel) return "called OpenAI";
      if (result.decision.analysis.exclusion_reason !== "already_following") return "wrong exclusion";
      return null;
    },
  },
  {
    name: "J already contacted",
    needsModel: false,
    input: {
      ...base,
      instagramUsername: "already.contacted",
      displayName: "Already Contacted Media",
      bio: "Commercial videographer in Chicago.",
      followerCount: 4000,
      locationText: "Chicago, IL",
      alreadyContacted: true,
    },
    assert: (result) => {
      if (!result.ok) return "call failed";
      if (result.decision.calledModel) return "called OpenAI";
      if (result.decision.analysis.exclusion_reason !== "already_contacted") return "wrong exclusion";
      return null;
    },
  },
  {
    name: "K below minimum followers",
    needsModel: false,
    input: {
      ...base,
      instagramUsername: "small.media",
      displayName: "Small Media",
      bio: "Real estate photographer.",
      followerCount: 300,
      locationText: "Austin, TX",
    },
    assert: (result) => {
      if (!result.ok) return "call failed";
      if (result.decision.calledModel) return "called OpenAI";
      if (result.decision.fitLabel !== "skip") return "expected skip";
      return null;
    },
  },
  {
    name: "L above maximum followers",
    needsModel: false,
    input: {
      ...base,
      instagramUsername: "huge.studio",
      displayName: "Huge Studio",
      bio: "National production company.",
      followerCount: 400000,
      locationText: "Los Angeles, CA",
    },
    assert: (result) => {
      if (!result.ok) return "call failed";
      if (result.decision.calledModel) return "called OpenAI";
      if (result.decision.fitLabel !== "skip") return "expected skip";
      return null;
    },
  },
  {
    name: "M business name has no person name",
    needsModel: true,
    input: {
      ...base,
      instagramUsername: "gulfcoastaerial",
      displayName: "Gulf Coast Aerial Media",
      bio: "Paid drone and listing media for coastal real estate teams.",
      followerCount: 4200,
      locationText: "Gulf Shores, AL",
    },
    assert: (result) => (result.ok && result.decision.firstName === null ? null : "expected no first name"),
  },
  {
    name: "N Tyler Smith",
    needsModel: true,
    input: {
      ...base,
      instagramUsername: "tylersmith.photo",
      displayName: "Tyler Smith",
      bio: "Real estate photographer based in Tampa.",
      followerCount: 2600,
      locationText: "Tampa, FL",
    },
    assert: (result) =>
      result.ok && result.decision.firstName?.toLowerCase() === "tyler" ? null : "expected Tyler",
  },
];

async function main() {
const configured = Boolean(process.env.OPENAI_API_KEY?.trim());
let calls = 0;
let failed = 0;

for (const item of cases) {
  if (item.needsModel && !configured) {
    console.log(`skip ${item.name} (OpenAI is not configured)`);
    continue;
  }
  const result = await evaluateProspect(item.input, rules, targeting);
  if (result.ok && result.decision.calledModel) calls += 1;
  const problem = item.assert(result);
  const summary = result.ok
    ? `${result.decision.fitLabel} ${result.decision.fitScore} ${result.decision.category ?? "no category"} model=${result.decision.calledModel}`
    : result.error;
  if (problem) {
    failed += 1;
    console.log(`FAIL ${item.name}: ${problem} (${summary})`);
  } else {
    console.log(`ok ${item.name}: ${summary}`);
  }
}

console.log(`model ${configured ? QUALIFICATION_MODEL : "not called"}`);
console.log(`openai calls ${calls}`);
if (failed) process.exit(1);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Qualification test failed.";
  console.error(message);
  process.exit(1);
});
