export const WORKER_VERSION = "6";

export const AUTH_FAILURE_MESSAGE =
  "Worker API authentication failed. Verify that WORKER_API_SECRET matches the value configured in Vercel.";

export const VERSION_MISMATCH_MESSAGE = "Worker update required. Run git pull && npm install.";

export function startupBlock(statusCode: number, minSupported: string | null, workerVersion = WORKER_VERSION) {
  if (statusCode === 401) return AUTH_FAILURE_MESSAGE;
  if (minSupported && minSupported !== workerVersion) return VERSION_MISMATCH_MESSAGE;
  return null;
}
