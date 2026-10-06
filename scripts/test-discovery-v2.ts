import { feedCandidates, suggestedCandidates } from "../worker/instagram/interpret";
import { CONFIG_CACHE_MS, shouldRefreshConfig } from "../worker/cloud/client";
import { QualificationQueue } from "../worker/discovery/qualify-queue";
import {
  CandidateQueue,
  SessionUsernameCache,
  chunkUsernames,
  unseenUsernames,
} from "../worker/discovery/queue";
import { collectSuggestedUsernames, prioritizeCandidates } from "../worker/discovery/sources";
import { backfillFollowRelationship, followingBadge } from "../lib/prospects/following";
import { formatDiscoveryStatus, parseDiscoveryStatus } from "../lib/worker/discovery-status";
import { PAGE_SIZE, PAGE_SIZE_OPTIONS, pageSizeFromParam } from "../lib/constants/prospects";
import type { DomSnapshot } from "../worker/instagram/types";

const failures: string[] = [];
function check(name: string, condition: boolean) {
  if (!condition) failures.push(name);
  else console.log(`ok ${name}`);
}

async function main() {

const queue = new CandidateQueue(2);
check("queue accepts a candidate", queue.enqueue(sample("alpha", "suggested_accounts")) === "queued");
check("queue dedupes the same username", queue.enqueue(sample("@Alpha", "home_feed")) === "duplicate");
check("queue refills below the target", queue.needsRefill());
queue.enqueue(sample("bravo", "home_feed"));
check("full queue does not request more", queue.needsRefill() === false);

const first = queue.claim("profile-tab-1");
const second = queue.claim("profile-tab-2");
const third = queue.claim("profile-tab-1");
check("tab 1 claims alpha", first?.username === "alpha");
check("tab 2 claims bravo", second?.username === "bravo");
check("a username is not claimed twice", third === null);
queue.fail("alpha");
check("tab failure skips that candidate", queue.claim("profile-tab-2") === null);
queue.complete("bravo", "done");
queue.enqueue(sample("charlie", "home_feed"));
const released = queue.claim("profile-tab-1");
queue.release("charlie");
check("released candidate returns to pending", queue.claim("profile-tab-2")?.username === "charlie");
check("released claim was charlie", released?.username === "charlie");

const cache = new SessionUsernameCache();
cache.remember("alpha", true);
const unseen = unseenUsernames(["alpha", "delta", "@delta"], cache, queue);
check("session cache skips a known username", unseen.skippedFromCache === 1 && unseen.fresh.join() === "delta");
check("batch check chunks stay within 25", chunkUsernames(Array.from({ length: 30 }, (_, index) => `user${index}`), 15).every((chunk) => chunk.length <= 15) && chunkUsernames(["a"], 15).length === 1);

const home = [{ username: "homeonly", profileUrl: "https://www.instagram.com/homeonly/", postUrl: null }];
const suggested = [{ username: "suggested", profileUrl: "https://www.instagram.com/suggested/", postUrl: null }, home[0]];
const preferred = prioritizeCandidates({
  suggested,
  home,
  priority: "suggested_first",
  homeEnabled: true,
  suggestedEnabled: true,
});
check("suggested source is preferred", preferred[0]?.username === "suggested" && preferred[0]?.source === "suggested_accounts");
check("duplicate username keeps the higher-priority source", preferred.filter((item) => item.username === "homeonly").length === 1 && preferred.find((item) => item.username === "homeonly")?.source === "suggested_accounts");
const homeFirst = prioritizeCandidates({ suggested, home, priority: "home_first", homeEnabled: true, suggestedEnabled: false });
check("disabled suggested source is omitted", homeFirst.every((item) => item.source === "home_feed"));

const sections = collectSuggestedUsernames([
  { heading: "Suggested for you", hrefs: ["https://www.instagram.com/alpha/", "/bravo/", "/explore/people/", "/p/abc/"] },
  { heading: "Home", hrefs: ["https://www.instagram.com/not-suggested/"] },
]);
check("suggested heading extracts profile cards", sections.join() === "alpha,bravo");
const dom = { suggestedProfiles: [{ username: "card", href: "/card/" }], articles: [{ links: [{ href: "/homeuser/", text: "" }, { href: "/p/post/", text: "" }] }] } as DomSnapshot;
check("home extraction reads articles", feedCandidates(dom).some((item) => item.username === "homeuser"));
check("suggested extraction reads suggestion cards", suggestedCandidates(dom).some((item) => item.username === "card"));

check("already following renders Yes", followingBadge({ already_following: true, follow_relationship: null }) === "Yes");
check("stored not following renders No", followingBadge({ already_following: false, follow_relationship: "not_following" }) === "No");
check("requested renders Requested", followingBadge({ follow_relationship: "requested" }) === "Requested");
check("old unchecked false renders Unknown", followingBadge({ already_following: false, follow_relationship: null }) === "Unknown");
check("backfill true is following", backfillFollowRelationship(true) === "following");
check("backfill false is unknown", backfillFollowRelationship(false) === "unknown");

const status = parseDiscoveryStatus(formatDiscoveryStatus({ source: "Suggested Accounts", pending: 7, tab1: "alpha", tab2: null }));
check("worker status keeps queue and tabs", status?.pending === "7" && status.tab1 === "@alpha" && status.tab2 === "idle" && status.pool === null);
const pooled = parseDiscoveryStatus(formatDiscoveryStatus({
  source: "Seed network",
  pending: 0,
  tab1: null,
  tab2: null,
  pool: { total: 34, ranked: 0, explorationEligible: 14, deferred: 20, highest: 33 },
}));
check("worker status keeps candidate pool health", pooled?.pool?.total === 34 && pooled.pool.ranked === 0 && pooled.pool.explorationEligible === 14 && pooled.pool.deferred === 20 && pooled.pool.highest === 33);

async function checkQualification() {
  let started = 0;
  let release = () => undefined as void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const qualify = new QualificationQueue(2, async () => {
    started += 1;
    await gate;
  });
  const accepted = qualify.enqueue("one");
  qualify.enqueue("two");
  qualify.enqueue("three");
  await new Promise((resolve) => setTimeout(resolve, 20));
  check("qualification enqueue returns before completion", accepted === true);
  check("qualification concurrency stays at 2", started === 2 && qualify.activeCount === 2 && qualify.pendingCount === 1);
  release();
  await qualify.drain();
  check("qualification queue drains", qualify.activeCount === 0 && qualify.pendingCount === 0);
}

await checkQualification();

check("config cache lasts 60 seconds", CONFIG_CACHE_MS === 60_000 && shouldRefreshConfig(1_000, 30_000) === false && shouldRefreshConfig(1_000, 61_001) === true);
check("prospect pages default to 25 rows", PAGE_SIZE === 25 && pageSizeFromParam("50") === 50 && pageSizeFromParam("10") === 25);
check("page size options are bounded", PAGE_SIZE_OPTIONS.join() === "25,50,100");

const pending = new CandidateQueue(10);
pending.enqueue(sample("keep", "home_feed"));
check("shutdown can read the pending queue", pending.pendingCandidates().length === 1 && pending.pendingCandidates()[0]?.username === "keep");

if (failures.length > 0) {
  console.error(failures.map((name) => `FAIL ${name}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log("discovery v2 checks passed");
}
}

main();

function sample(username: string, source: "home_feed" | "suggested_accounts") {
  return {
    username,
    profileUrl: `https://www.instagram.com/${username.replace("@", "")}/`,
    source,
    sourcePostUrl: null,
    sourceThumbnailUrl: null,
    discoveredAt: "2026-10-02T00:00:00.000Z",
  };
}
