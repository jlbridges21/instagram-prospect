import { loadLocalEnv } from "./load-env";

loadLocalEnv();

async function main() {
  const username = process.argv.slice(2).find((arg) => !arg.startsWith("-"));
  if (!username) {
    console.error("Usage: npm run agent:inspect-seed -- christopherhelkey");
    process.exitCode = 1;
    return;
  }
  const owner = username.replace(/^@/, "").trim().toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(owner)) {
    console.error("Provide one Instagram username, for example christopherhelkey.");
    process.exitCode = 1;
    return;
  }
  const { launchBrowser } = await import("../worker/browser/launch");
  const { openSeedSuggestions } = await import("../worker/instagram/open-seed");
  const { openSeedFollowing } = await import("../worker/instagram/open-following");
  const { SEED_NETWORK_SAMPLE_DEFAULT } = await import("../lib/discovery/seeds");
  const { context, page } = await launchBrowser();
  try {
    const suggestions = await openSeedSuggestions(page, owner);
    const network = await openSeedFollowing(page, owner, SEED_NETWORK_SAMPLE_DEFAULT);
    console.log(`Seed: @${owner}`);
    console.log("Profile suggestions:");
    console.log(`heading found: ${suggestions.headings.length > 0 ? "yes" : "no"}`);
    console.log(`candidates: ${suggestions.usernames.length}`);
    console.log("Following:");
    console.log(`button found: ${network.buttonFound ? "yes" : "no"}`);
    console.log(`dialog opened: ${network.dialogOpened ? "yes" : "no"}`);
    console.log(`profile links found: ${network.profileLinksFound}`);
    console.log(`normalized usernames: ${network.normalizedUsernames}`);
    console.log(`duplicates: ${network.duplicates}`);
    console.log(`reserved paths: ${network.reserved}`);
    console.log(`seed self: ${network.seedSelf}`);
    console.log(`already known: ${network.alreadyKnown}`);
    console.log(`usable: ${network.usernames.length}`);
    if (network.reason) console.log(`reason: ${network.reason}`);
    if (network.usernames.length > 0) {
      console.log("Sample:");
      for (const name of network.usernames) console.log(`@${name}`);
    }
    console.log("Inspect finished. Nothing was saved, qualified, followed, or messaged.");
  } finally {
    await context.close().catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Seed inspect failed.");
  process.exitCode = 1;
});
