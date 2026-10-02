# ShootPortal Outreach

Internal dashboard for reviewing Instagram prospects for ShootPortal. It is a separate app from the main ShootPortal product, with its own Supabase database, and it is meant to be deployed on Vercel.

The website runs on Vercel. A local Node.js and Playwright worker, for macOS or Windows, browses Instagram in a dedicated browser profile. The worker does not store an Instagram password, and it does not run on Vercel.

## Stack

- Next.js (App Router) and TypeScript
- Tailwind CSS
- Supabase Auth and Postgres
- Lucide icons
- Inter

## What you need

- Node.js 20 or newer
- A free [Supabase](https://supabase.com) account
- A [Vercel](https://vercel.com) account when you are ready to deploy

## 1. Install

Open a terminal in this project folder and run:

```bash
npm install
```

## 2. Create the Supabase project

1. In Supabase, create a new project. Do not reuse the main ShootPortal database.
2. Wait until the project finishes provisioning.
3. Open **SQL Editor**, click **New query**, and paste the full contents of:

   `supabase/migrations/20261002120000_init.sql`

4. Run that query once. It creates the tables, the default outreach message, targeting rules, indexes, and row level security.
5. Open **Project Settings → API**.
6. Copy the project URL, the `anon` public key, and the `service_role` secret key.

The service role key bypasses row level security. It is only used by the seed script on your computer. Never put it in frontend code, and never prefix it with `NEXT_PUBLIC_`.

## 3. Add environment variables

Copy the example file:

```bash
cp .env.example .env.local
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env.local
```

Fill in `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
OPENAI_API_KEY=
WORKER_API_SECRET=
OUTREACH_APP_URL=http://localhost:3000
WORKER_BROWSER_CHANNEL=chrome
WORKER_HEADLESS=false
```

`OPENAI_API_KEY` stays on the server. The local worker does not need it. `OUTREACH_APP_URL` is the dashboard the worker calls. Use `http://localhost:3000` on this computer, or the deployed Vercel URL when the worker should talk to production.

Restart the dev server after changing this file.

## 4. Create your login

This app does not have public signup.

1. In Supabase, open **Authentication → Sign In / Providers** and make sure Email is enabled.
2. Turn off public sign-ups if that toggle is available.
3. Open **Authentication → Users → Add user**.
4. Enter your email and a password, and confirm the user so email verification is not required.
5. Under **Authentication → URL Configuration**, set the site URL to `http://localhost:3000` while you are developing.

## 5. Run the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You should land on the sign-in page. After signing in, the dashboard opens. Counts stay at zero until there are prospects.

## 6. Load sample data

The sample profiles are fictional. They are not real Instagram accounts.

```bash
npm run db:seed
```

Refresh the dashboard. You should see prospects across several statuses, a review queue, follow-ups, and activity.

Remove only the sample rows:

```bash
npm run db:clear-seed
```

You can also paste `supabase/seed/clear_sample_data.sql` into the Supabase SQL editor. That deletes rows marked `is_sample` and leaves anything else alone.

## 7. Deploy to Vercel

1. Push this project to GitHub, or import the folder in Vercel.
2. Create a Vercel project from this repository.
3. Set the Vercel project **Root Directory** to the repository root (`.`). Production branch: `main`.
4. Add these environment variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `OPENAI_API_KEY`
   - `WORKER_API_SECRET`
5. Deploy.
6. In Supabase **Authentication → URL Configuration**, add your Vercel URL, for example `https://your-app.vercel.app`.

The GitHub repository must contain this application, not the original Create Next App starter. Vercel builds whatever is on `main`.

The local worker does not run on Vercel. Vercel only hosts the website. Leave `WORKER_SIMULATION_MODE` unset on Vercel.

## Prompt 2 migration

After the initial migration, run `supabase/migrations/20261002190000_prompt2.sql` once in the Supabase SQL editor. Do not rerun the initial migration.

## Prompt 3 migration

After the Prompt 2 migration, run `supabase/migrations/20261002210000_prompt3_ai.sql` once. Do not edit or rerun the earlier migrations.

Qualification uses `OPENAI_API_KEY` on the server only. The model id lives in `lib/ai/config.ts`. Fit thresholds and the AI on/off switch are in Settings → AI.

```bash
npm run ai:test
```

That script qualifies fictional profiles. It does not open Instagram or save prospects.

## Prompt 4 migration

After the Prompt 3 migration, run `supabase/migrations/20261002230000_prompt4_outreach_queue.sql` once. Do not edit or rerun the earlier migrations.

Outreach automation starts paused. The local simulator can complete queued jobs without opening Instagram:

```bash
npm run outreach:test
npm run worker:simulate -- --once
```

Set `WORKER_SIMULATION_MODE=true` only on the machine that runs the simulator. Do not turn that on for the Vercel deployment.

## Prompt 5 migration

After the Prompt 4 migration, run `supabase/migrations/20261003090000_prompt5_worker.sql` once. Do not edit or rerun the earlier migrations.

## Worker API

These routes accept a bearer token. The worker never talks to Supabase directly:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/worker/heartbeat

curl -s -X POST http://localhost:3000/api/worker/heartbeat \
  -H "Authorization: Bearer $WORKER_API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"worker_id":"local-mac","machine_name":"Studio Mac","platform":"darwin","hostname":"studio","status":"online"}'

curl -s http://localhost:3000/api/worker/config \
  -H "Authorization: Bearer $WORKER_API_SECRET"

curl -s -X POST http://localhost:3000/api/worker/prospects \
  -H "Authorization: Bearer $WORKER_API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"instagram_username":"example.aerial","display_name":"Example Aerial","follower_count":1200,"source":"home_feed"}'
```

A request without the bearer token returns 401. Do not prefix `WORKER_API_SECRET` with `NEXT_PUBLIC_`.

## Local worker

The worker is a local Node.js process. It uses a dedicated Chrome profile, not your personal Chrome profile.

| | |
| --- | --- |
| Browser profile | `~/ShootPortal-Outreach/browser-profile` on macOS, `%USERPROFILE%\ShootPortal-Outreach\browser-profile` on Windows |
| Worker id | `ShootPortal-Outreach/worker.json` |
| Logs | `ShootPortal-Outreach/logs` |

Each machine creates its own worker id and browser profile. Do not copy `browser-profile` from macOS to Windows. Clone the repo, install, copy the environment variables, run setup, and sign in to Instagram once on the new machine.

### Mac setup

```bash
git clone https://github.com/jlbridges21/instagram-prospect.git
cd instagram-prospect
npm install
```

Create `.env.local` with at least:

```bash
OUTREACH_APP_URL=http://localhost:3000
WORKER_API_SECRET=the-same-secret-as-the-dashboard
```

Then:

```bash
npm run agent:setup
npm run agent:login
npm run agent
```

### Windows setup

Windows does not need WSL.

1. Install Node.js LTS.
2. Install Git.
3. Clone the repository.
4. Open PowerShell or Command Prompt in the repository folder.
5. Run `npm install`.
6. Create `.env.local`.
7. Set `OUTREACH_APP_URL` and `WORKER_API_SECRET`.
8. Run `npm run agent:setup`.
9. Run `npm run agent:login` and sign in to Instagram in the browser window.
10. Run `npm run agent`.

PowerShell example for the env file:

```powershell
Copy-Item .env.example .env.local
```

### First run and Instagram login

`npm run agent:setup` checks Node, creates the local folders, writes a worker id, and checks the worker API. It does not ask for an Instagram password.

`npm run agent:login` opens the dedicated browser. Sign in there. Chrome keeps the session in that profile.

`npm run agent` starts discovery when discovery is on. Outreach stays paused until you resume it on the Worker page, so the first run does not send messages.

Stop the worker with Ctrl+C. The browser profile stays on disk.

### Other worker commands

```bash
npm run agent:status
npm run agent:smoke
npm run agent -- --discovery-only
npm run agent -- --no-write
npm run worker:test
```

`--discovery-only` can save prospects and ask the server to qualify them. It does not follow or send. `--no-write` does not save prospects, follow, or send. `agent:smoke` checks the cloud connection, Instagram login, and the home feed, then exits.

If Google Chrome is missing, set `WORKER_BROWSER_CHANNEL` only after installing Chrome, or run `npx playwright install chromium` and let the worker fall back when the Chrome channel fails. Supported channel value: `chrome`.

## Useful commands

```bash
npm run dev          # local website
npm run lint         # checks code style
npm run typecheck    # TypeScript
npm run build        # production build
npm run db:seed      # insert fictional prospects
npm run db:clear-seed
npm run agent        # local Playwright worker
npm run agent:setup
npm run agent:login
npm run agent:smoke
npm run worker:test  # Instagram fixture tests, no live follow or send
npm run ai:test      # fictional qualification cases
```

## Database notes

Authenticated users can read and update the workspace tables. Anonymous visitors cannot. Row level security is defined in the migration.

Status values such as `review` and `approved` are stored as stable keys. The words shown in the interface live in the app, so labels can change without rewriting history.

The outreach message is stored in the `settings` table. `{{name}}` is replaced with a first name when one is known, otherwise with the Instagram username. The app does not rewrite that message.

## What the worker will not do

- Solve CAPTCHAs or bypass checkpoints
- Store or ask for the Instagram password
- Approve prospects by itself
- Send a message or follow an account unless the cloud queue has a job and outreach is running
