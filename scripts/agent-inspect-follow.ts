import { loadLocalEnv } from "./load-env";

loadLocalEnv();

async function main() {
  const username = process.argv.slice(2).find((arg) => !arg.startsWith("-"))?.replace(/^@/, "").trim().toLowerCase();
  if (!username || !/^[a-z0-9._]{1,30}$/.test(username)) {
    console.error("Usage: npm run agent:inspect-follow -- greg.fabre");
    process.exitCode = 1;
    return;
  }
  const { launchBrowser } = await import("../worker/browser/launch");
  const { inspectFollow } = await import("../worker/instagram/actions");
  const { context, page } = await launchBrowser();
  try {
    await inspectFollow(page, username);
  } finally {
    await context.close().catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Follow inspection failed.");
  process.exitCode = 1;
});
