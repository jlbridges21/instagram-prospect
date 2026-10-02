import { loadLocalEnv } from "./load-env";

loadLocalEnv();

async function main() {
  const username = process.argv.slice(2).find((arg) => !arg.startsWith("-"));
  if (!username) {
    console.error("Usage: npm run agent:inspect -- fpv_teams");
    process.exitCode = 1;
    return;
  }
  const { inspectUsername } = await import("../worker/run");
  await inspectUsername(username);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Inspect failed.");
  process.exitCode = 1;
});
