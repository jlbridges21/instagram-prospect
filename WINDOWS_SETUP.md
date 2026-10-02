# Windows worker setup

The website stays on Vercel. This computer only runs the browser worker. You do not need WSL.

## Install

Open PowerShell.

```powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git
```

Close PowerShell and open it again so `node` and `git` are available.

```powershell
git clone https://github.com/jlbridges21/instagram-prospect.git
cd instagram-prospect
npm install
copy .env.example .env.local
notepad .env.local
```

Put these lines in `.env.local`. Use the same `WORKER_API_SECRET` that is set on Vercel.

```text
OUTREACH_APP_URL=https://instagram-prospect-sigma.vercel.app
WORKER_API_SECRET=paste-the-vercel-secret
WORKER_BROWSER_CHANNEL=chrome
WORKER_HEADLESS=false
```

The Windows worker does not need the OpenAI key or the Supabase service-role key.

## First run

```powershell
npm run agent:setup
npm run agent:login
```

Sign in to Instagram in the browser window that opens. That window uses a dedicated profile at `%USERPROFILE%\ShootPortal-Outreach\browser-profile`. It is not your everyday Chrome profile. Press Ctrl+C after you are signed in.

```powershell
npm run agent:smoke
```

A good smoke test looks like this:

```text
✓ Cloud connected
✓ Worker authenticated
✓ Version compatible
✓ Chrome available
Authenticated: yes
Home feed visible: yes
Visible candidate posts: 6
Worker API: connected
```

Then discover without sending anything:

```powershell
npm run agent -- --discovery-only
```

You should see lines like:

```text
@example
relationship: not_following
followers: 4821
display_name: Example Aerial
AI: strong_fit 91
```

Accounts you already follow should say `relationship: following` and should not appear in the Review Queue.

Stop the worker with Ctrl+C. The Worker page should show Connection: Offline and Last task: Stopped.

## Daily commands

```powershell
npm run agent:status
npm run agent:smoke
npm run agent -- --debug
npm run agent -- --discovery-only
npm run agent -- --outreach-dry-run
npm run agent -- --single-outreach
npm run agent
```

`--debug` prints which extraction method found the follower count, relationship, and bio.

`--outreach-dry-run` opens the next queued profile and can type the message, but it does not click Follow or Send and it does not complete the job.

`--single-outreach` runs one approved prospect's verify, follow, and send sequence, then stops. Leave outreach paused until you mean to do that.

## Update the worker

```powershell
cd $env:USERPROFILE\instagram-prospect
git pull
npm install
npm run agent
```

If the worker says `Worker update required`, those two commands are the fix.

## If authentication fails

```text
Worker API authentication failed. Verify that WORKER_API_SECRET matches the value configured in Vercel.
```

The worker stops. Copy the Vercel value again. Do not keep retrying a wrong secret.

Do not copy the `browser-profile` folder from a Mac. Sign in once on this PC.
