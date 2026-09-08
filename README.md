# Subkill — a subscription-watching agent

Syncs with your Gmail, finds subscription and free-trial emails, and tracks their renewal
dates. Before each renewal it emails you asking whether to keep or cancel. If you don't
respond within the grace period, it freezes the dedicated virtual card for that one
subscription — nothing else on your account is touched.

## How it actually works (read this before wiring up real cards)

1. **Detection** — searches Gmail for receipt/subscription/trial-shaped emails, then sends
   each candidate to Claude to pull out merchant, amount, currency, billing cycle, and
   renewal date. Nothing is guessed; if the email doesn't state a date, the field stays empty.
2. **Two protection modes, per subscription** — everything starts as **notify only**: the
   agent tracks it and emails a reminder before renewal, but can't stop the charge since no
   card is tied to it. From the dashboard you can hit "Enable auto-freeze" on any
   subscription to have Bitnob issue it a **dedicated virtual card** — from then on, that one
   is **card-managed**, and a missed reminder gets it frozen automatically. This is meant for
   the subscriptions people actually forget about; the ones you signed up for two minutes ago
   with a card you already trust yourself to cancel don't need the extra step.
3. **Reminder → grace period → action (card-managed only)** — `REMINDER_DAYS_BEFORE` days out,
   you get an email with one-click Keep / Cancel links, for every subscription regardless of
   mode. For card-managed ones, no click within `GRACE_PERIOD_HOURS` freezes that
   subscription's card and marks it paused — resume (unfreeze) anytime from the dashboard.
   For notify-only ones, a missed reminder just gets flagged; there's no card to act on, so
   it likely renewed.

## What you need before this runs for real

- A **Google Cloud project** with the Gmail API enabled, an OAuth consent screen, and a
  Client ID/Secret — set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`.
  While the app is in "Testing" mode, only accounts you add as test users can connect.
- A **Postgres database** (Supabase, Neon, or Railway's own Postgres all work) —
  set `DATABASE_URL`, then run `npm run migrate` once to create the tables.
- A **Bitnob account with card-issuing access approved** (email hello@withbitnob.com — this
  needs KYC/BVN per cardholder before it works) — set `BITNOB_API_KEY`. Until this is
  approved, subscription tracking and reminders still work; card freezing just no-ops with a
  logged warning.
- An **Anthropic API key** for the extraction step — set `ANTHROPIC_API_KEY`.

## Running it locally first

```bash
npm install
cp .env.example .env   # fill in the values from the table below
npm run migrate
npm start
```
Then visit `http://localhost:3000`, click "Connect Gmail," and hit "Sync now."

## What you need, and the free way to get each one

| Piece | Free option | Notes |
|---|---|---|
| Postgres | **Neon** (neon.tech) | 100 compute-hours/mo, 0.5GB storage per project, scales to zero, no card needed. Doesn't pause on inactivity the way Supabase's free tier does — better fit for a cron-driven app that's quiet most of the day. |
| App hosting | **Render** (render.com) free web service | No card needed. Spins down after 15 min idle, ~30-60s cold start on the next request — fine for a dashboard you check occasionally, see the cron workaround below. |
| Gmail access | **Google Cloud** (console.cloud.google.com) | Free — Gmail API has no usage cost at this scale. You just need a project with the Gmail API enabled and an OAuth consent screen. |
| Email extraction | **Anthropic API** | Not free, but cheap at this volume — you're sending short email bodies, a few hundred a month costs a small fraction of a dollar. |
| Virtual cards | **Bitnob** sandbox | Free, self-serve, no KYC needed for sandbox testing — sign up and get sandbox keys immediately. Production (real cards, real freezing) needs approval and per-cardholder KYC/BVN — budget a few days for that when you're ready to go live. |

### 1. Postgres — Neon
1. Sign up at neon.tech (no card required).
2. Create a project, copy the connection string it gives you.
3. Paste it into `DATABASE_URL` in your `.env`.

### 2. Gmail API — Google Cloud
1. console.cloud.google.com → new project.
2. **APIs & Services → Library** → search "Gmail API" → Enable.
3. **APIs & Services → OAuth consent screen** → External → fill in app name/email → under "Test users," add your own Gmail address (required while the app is unpublished — anyone not listed can't connect).
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID** → type "Web application" → add an authorized redirect URI: `https://<your-render-url>/auth/google/callback` (and `http://localhost:3000/auth/google/callback` for local testing).
5. Copy the Client ID and Secret into `.env`.

### 3. Anthropic API key
1. console.anthropic.com → API Keys → create one.
2. Put it in `ANTHROPIC_API_KEY`.

### 4. Bitnob sandbox
1. Sign up at bitnob.com for a free sandbox account — no approval wait for sandbox.
2. Grab your sandbox API key, put it in `BITNOB_API_KEY`, leave `BITNOB_BASE_URL` pointed at `sandboxapi.bitnob.co`.
3. When you're ready for real cards, email hello@withbitnob.com to move to production — that's when KYC/BVN per cardholder kicks in.

### 5. Deploy to Render
1. Push this folder to a GitHub repo.
2. render.com → New → Web Service → connect the repo.
3. Build command: `npm install`. Start command: `npm start`.
4. Add every variable from `.env.example` under Environment.
5. Deploy — you'll get a URL like `subkill.onrender.com`. Update `BASE_URL` and `GOOGLE_REDIRECT_URI` in Render's env vars to match it, then redeploy.
6. Run the schema once against your Neon database: easiest is to temporarily add `npm run migrate` as a one-off job in Render's shell, or run `npm run migrate` from your own machine with `DATABASE_URL` pointed at Neon.

### 6. Keep the reminders firing on a free host
Render's free tier sleeps after 15 minutes idle — if nobody's visited the dashboard, the in-process hourly cron won't run either. The app also exposes `GET /api/cron/run?secret=<CRON_SECRET>` for exactly this reason:
1. Set a random `CRON_SECRET` in your env vars.
2. Sign up free at **cron-job.org** (no card).
3. Add a job that hits `https://<your-app>.onrender.com/api/cron/run?secret=<your secret>` every hour — this both wakes the app up and runs the reminder/action check.

Once you're on a paid always-on tier (Render Starter, Railway, etc.) this step is optional — the in-process cron alone is enough.

## Known gaps to fix before trusting it with real subscriptions

- Free-trial detection depends on the trial provider actually emailing a start/end date —
  some don't state one clearly, and those will show up with no renewal date until you check.
- Card issuing is gated on Bitnob approving your account — budget a few days for that before
  the freeze step can do anything.
- Detection re-runs on every "Sync now" click for now; wiring Gmail's push notifications
  (via Pub/Sub) would make it live instead of on-demand — worth doing once the manual flow
  feels right.
