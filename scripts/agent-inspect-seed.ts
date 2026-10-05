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
  const { context, page } = await launchBrowser();
  try {
    const opened = await openSeedSuggestions(page, owner);
    if (opened.usernames.length === 0) console.log("No candidate usernames.");
    else for (const name of opened.usernames) console.log(`@${name}`);
    console.log("Inspect finished. Nothing was saved, qualified, followed, or messaged.");
  } finally {
    await context.close().catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Seed inspect failed.");
  process.exitCode = 1;
});
