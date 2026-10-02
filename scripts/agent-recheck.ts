import { loadLocalEnv } from "./load-env";

loadLocalEnv();

async function main() {
  const apply = process.argv.includes("--apply");
  const username = process.argv.slice(2).find((arg) => !arg.startsWith("-"));
  if (!username) {
    console.error("Usage: npm run agent:recheck -- fpv_teams");
    console.error("Add --apply only to save a following or requested result for a discovered prospect.");
    process.exitCode = 1;
    return;
  }
  const { inspectUsername } = await import("../worker/run");
  const { CloudClient } = await import("../worker/cloud/client");
  const result = await inspectUsername(username);
  if (!result?.profileExists) return;
  if (!apply) {
    console.log("No prospect was updated. Add --apply to save a following or requested result.");
    return;
  }
  const baseUrl = process.env.OUTREACH_APP_URL?.trim().replace(/\/$/, "");
  const secret = process.env.WORKER_API_SECRET?.trim();
  if (!baseUrl || !secret) return;
  const saved = await new CloudClient(baseUrl, secret).recheckRelationship(result.profile.username || username, result.relationship);
  console.log(saved.applied ? `Saved @${username} as already following.` : saved.reason || "No change was saved.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Recheck failed.");
  process.exitCode = 1;
});
