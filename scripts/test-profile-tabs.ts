import assert from "node:assert/strict";
import {
  BLANK_TAB_LIMIT_MS,
  browserRestartRequired,
  profileTabHealth,
  selectInspectionTab,
} from "../lib/worker/profile-tabs";

const now = 1_700_000_000_000;
const base = {
  closed: false,
  crashed: false,
  navigationFailed: false,
  blankSince: null as number | null,
  now,
};

const healthy = (url: string) => profileTabHealth({ ...base, url });
assert.equal(healthy("https://www.instagram.com/jxframes/").healthy, true);
assert.equal(healthy("https://www.instagram.com/").healthy, true);

const freshBlank = profileTabHealth({ ...base, url: "about:blank", blankSince: now });
assert.equal(freshBlank.healthy, true);
const staleBlank = profileTabHealth({ ...base, url: "about:blank", blankSince: now - BLANK_TAB_LIMIT_MS });
assert.equal(staleBlank.healthy, false);
assert.equal(staleBlank.reason, "about:blank");
assert.equal(profileTabHealth({ ...base, url: null }).reason, "detached");
assert.equal(profileTabHealth({ ...base, closed: true, url: null }).reason, "closed");
assert.equal(profileTabHealth({ ...base, url: "https://www.instagram.com/", navigationFailed: true }).reason, "navigation_failed");
assert.equal(profileTabHealth({ ...base, url: "chrome-error://chromewebdata/" }).reason, "missing_instagram");

const both = selectInspectionTab({
  tabs: [
    { id: "profile-tab-1", healthy: true },
    { id: "profile-tab-2", healthy: true },
  ],
  lastUsed: null,
});
assert.equal(both.assign, "profile-tab-1");
assert.deepEqual(both.repair, []);
const next = selectInspectionTab({
  tabs: [
    { id: "profile-tab-1", healthy: true },
    { id: "profile-tab-2", healthy: true },
  ],
  lastUsed: "profile-tab-1",
});
assert.equal(next.assign, "profile-tab-2");

const blankSecond = selectInspectionTab({
  tabs: [
    { id: "profile-tab-1", healthy: true },
    { id: "profile-tab-2", healthy: false },
  ],
  lastUsed: "profile-tab-1",
});
assert.equal(blankSecond.assign, "profile-tab-1");
assert.deepEqual(blankSecond.repair, ["profile-tab-2"]);

const closedFirst = selectInspectionTab({
  tabs: [
    { id: "profile-tab-1", healthy: false },
    { id: "profile-tab-2", healthy: true },
  ],
  lastUsed: "profile-tab-2",
});
assert.equal(closedFirst.assign, "profile-tab-2");
assert.deepEqual(closedFirst.repair, ["profile-tab-1"]);

const recovered = ["https://www.instagram.com/", "https://www.instagram.com/"].map((url) => profileTabHealth({ ...base, url }));
assert.equal(recovered.every((tab) => tab.healthy), true);
assert.equal(browserRestartRequired({ contextConnected: true }), false);
assert.equal(browserRestartRequired({ contextConnected: false }), true);

console.log("profile tab recovery ok");
