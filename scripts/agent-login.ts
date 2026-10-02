import { loadLocalEnv } from "./load-env";

loadLocalEnv();

async function main() {
  const { runWorker } = await import("../worker/run");
  await runWorker("login");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Could not open Instagram.");
  process.exitCode = 1;
});
