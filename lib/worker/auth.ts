import "server-only";

import { timingSafeEqual } from "node:crypto";

export function isWorkerAuthorized(request: Request) {
  const expected = process.env.WORKER_API_SECRET;
  if (!expected) return false;

  const header = request.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return false;

  const provided = Buffer.from(header.slice(prefix.length));
  const secret = Buffer.from(expected);
  if (provided.length !== secret.length) {
    timingSafeEqual(secret, secret);
    return false;
  }

  return timingSafeEqual(provided, secret);
}

export function workerUnauthorized() {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

export function workerError(status: number, error: string) {
  return Response.json({ error }, { status });
}
