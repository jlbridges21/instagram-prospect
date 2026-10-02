import { loadLocalEnv } from "./load-env";

loadLocalEnv();

async function main() {
  const { runWorker } = await import("../worker/run");
  await runWorker("agent");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "The worker stopped.");
  process.exitCode = 1;
});
