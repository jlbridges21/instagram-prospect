# Local worker

This folder is the Mac and Windows Playwright worker. It does not run on Vercel.

The worker talks to the dashboard with `OUTREACH_APP_URL` and `WORKER_API_SECRET`. It does not contain the Supabase service-role key or the OpenAI key.

Browser state lives in the home directory:

- macOS: `~/ShootPortal-Outreach/browser-profile`
- Windows: `%USERPROFILE%\ShootPortal-Outreach\browser-profile`

Logs are in `ShootPortal-Outreach/logs`. The worker id is in `ShootPortal-Outreach/worker.json`.

```bash
npm run agent:setup
npm run agent:login
npm run agent
npm run agent:status
npm run agent:smoke
npm run agent -- --discovery-only
npm run agent -- --no-write
```

`WORKER_BROWSER_CHANNEL=chrome` uses installed Google Chrome. If that channel fails, the worker falls back to Playwright's Chromium. Install that browser with `npx playwright install chromium` when Chrome is missing.

Do not copy `browser-profile` between macOS and Windows. Sign in to Instagram once on each machine. The worker never asks for the Instagram password.
