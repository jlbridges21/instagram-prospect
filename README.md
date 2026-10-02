# ShootPortal Outreach

Internal dashboard for reviewing Instagram prospects for ShootPortal. It is a separate app from the main ShootPortal product, with its own Supabase database, and it is meant to be deployed on Vercel.

This version stores prospects, settings, follow-ups, activity, and worker status. It does not browse Instagram, send messages, follow accounts, or store Instagram passwords. A local worker for macOS and Windows will be added later.

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
```

`OPENAI_API_KEY` is reserved for a later step. Leave it blank for now. The app does not call OpenAI yet.

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

The local worker does not run on Vercel. Vercel only hosts the website. The worker, when it exists, runs on your Mac or Windows PC.

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

## Worker API

The local worker is not built yet. These routes accept a bearer token and talk to Supabase on the server:

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

`worker/` holds the cross-platform config for a future Playwright worker. It is not implemented.

```bash
npm run agent
```

That command currently exits and tells you the worker is not built. It does not open a browser.

When the worker is added, it will use a browser profile at `.worker/browser-profile` inside the project folder. That path is built from the current directory, so it works on macOS and Windows without a hardcoded user folder.

## Useful commands

```bash
npm run dev          # local website
npm run lint         # checks code style
npm run typecheck    # TypeScript
npm run build        # production build
npm run db:seed      # insert fictional prospects
npm run db:clear-seed
npm run agent        # reserved for the future worker
npm run ai:test      # fictional qualification cases
```

## Database notes

Authenticated users can read and update the workspace tables. Anonymous visitors cannot. Row level security is defined in the migration.

Status values such as `review` and `approved` are stored as stable keys. The words shown in the interface live in the app, so labels can change without rewriting history.

The outreach message is stored in the `settings` table. `{{name}}` is replaced with a first name when one is known, otherwise with the Instagram username. The app does not rewrite that message.

## What is not included yet

- Instagram discovery
- Playwright browser automation
- Sending messages or following accounts
- Automatic follow-ups
