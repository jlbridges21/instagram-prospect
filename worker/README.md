# Local worker

This folder is reserved for the ShootPortal outreach worker.

The worker is not built yet. It will not open a browser, log into Instagram, discover profiles, follow accounts, or send messages.

When it is added, it is meant to run on the operator's own computer:

- macOS (`darwin`)
- Windows (`win32`)

Linux is represented in the data model, but the first target machines are Mac and Windows.

The worker will use Node.js, Playwright, and a browser profile stored inside this project at `.worker/browser-profile`. That folder is created from the current working directory with `path.join`, so it is not tied to a macOS or Windows user folder.

Planned files, not created yet:

- `worker/index.ts` — process entry
- `worker/browser.ts` — Playwright browser and profile
- `worker/instagram.ts` — Instagram session actions

Until those files exist, `npm run agent` only explains that the worker is not implemented.

The dashboard reads worker status from the `worker_instances` table. Nothing in this folder writes to that table yet.
