import { loadLocalEnv } from "./load-env";

loadLocalEnv();

async function main() {
  const { runWorker } = await import("../worker/run");
  await runWorker("smoke");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Smoke test failed.");
  process.exitCode = 1;
});
