const base = process.env.APP_URL || "http://localhost:3000";
const secret = process.env.WORKER_API_SECRET;

if (!secret) {
  console.error("WORKER_API_SECRET is missing. Run with --env-file=.env.local");
  process.exit(1);
}

const username = "zz.outreach.api.test";
const followingUsername = "zz.outreach.api.follow";
const workerId = "api-test-worker";

async function call(path, { method = "GET", body, auth = true } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth) headers.Authorization = `Bearer ${secret}`;
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 180) };
  }
  return { status: response.status, json };
}

function assert(name, condition, detail) {
  if (!condition) {
    console.error(`FAIL ${name}`, detail ?? "");
    process.exitCode = 1;
    return;
  }
  console.log(`ok ${name}`);
}

const unauthorized = await call("/api/worker/heartbeat", {
  method: "POST",
  auth: false,
  body: { worker_id: workerId },
});
assert("unauthorized heartbeat is 401", unauthorized.status === 401, unauthorized);

const heartbeat = await call("/api/worker/heartbeat", {
  method: "POST",
  body: {
    worker_id: workerId,
    machine_name: "API Test Machine",
    platform: "darwin",
    hostname: "api-test",
    status: "online",
    current_task: "api test",
    browser_connected: false,
    instagram_authenticated: false,
  },
});
assert(
  "authorized heartbeat is 200",
  heartbeat.status === 200 && heartbeat.json?.ok === true,
  heartbeat,
);

const configDenied = await call("/api/worker/config", { auth: false });
assert("unauthorized config is 401", configDenied.status === 401, configDenied);

const config = await call("/api/worker/config");
const configText = JSON.stringify(config.json ?? {});
assert(
  "config is 200",
  config.status === 200 && typeof config.json?.heartbeatIntervalSeconds === "number",
  config,
);
assert(
  "config omits secrets",
  config.status === 200 &&
    !configText.includes("service_role") &&
    !/sk-|eyJ/.test(configText) &&
    !configText.toLowerCase().includes("password"),
  config,
);

const created = await call("/api/worker/prospects", {
  method: "POST",
  body: {
    instagram_username: username,
    display_name: "API Test Aerial",
    follower_count: 1500,
    source: "home_feed",
  },
});
assert("prospect create is 200", created.status === 200 && created.json?.created === true, created);

const duplicate = await call("/api/worker/prospects", {
  method: "POST",
  body: { instagram_username: `@${username}` },
});
assert(
  "duplicate is detected",
  duplicate.status === 200 && duplicate.json?.created === false && duplicate.json?.reason === "duplicate",
  duplicate,
);

const following = await call("/api/worker/prospects", {
  method: "POST",
  body: {
    instagram_username: followingUsername,
    already_following: true,
    display_name: "Already Followed",
  },
});
assert(
  "already following is stored and not queued",
  following.status === 200 &&
    following.json?.created === true &&
    following.json?.queued === false &&
    following.json?.status === "disqualified",
  following,
);

const invalid = await call("/api/worker/prospects", {
  method: "POST",
  body: { follower_count: -1 },
});
assert("invalid prospect is 400", invalid.status === 400, invalid);

const activity = await call("/api/worker/activity", {
  method: "POST",
  body: {
    event_type: "worker_started",
    description: "API test recorded a worker start.",
    prospect_id: created.json?.prospectId ?? null,
  },
});
assert("activity write is 200", activity.status === 200, activity);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (url && serviceKey) {
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };
  await fetch(`${url}/rest/v1/prospects?instagram_username=in.(${username},${followingUsername})`, {
    method: "DELETE",
    headers,
  });
  await fetch(`${url}/rest/v1/worker_instances?worker_id=eq.${workerId}`, {
    method: "DELETE",
    headers,
  });
  await fetch(`${url}/rest/v1/activity_log?description=eq.API%20test%20recorded%20a%20worker%20start.`, {
    method: "DELETE",
    headers,
  });
  console.log("cleaned test rows");
}

if (process.exitCode) process.exit(process.exitCode);
