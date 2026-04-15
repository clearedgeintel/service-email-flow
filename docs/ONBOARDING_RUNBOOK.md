# Customer Onboarding Runbook

> Step-by-step process to deploy a new single-tenant ServiceFlow instance for a customer. Target time: **30-45 minutes** including customer handoff.

**Prerequisites:**
- Customer name, Gmail address they want monitored, business phone, business location
- GitHub access to the ServiceFlow repo
- Your Railway, Supabase, Upstash, and Anthropic accounts

---

## Phase 1: Infrastructure (15 min)

### 1.1 Supabase — new project

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) → **New Project**
2. Name: `serviceflow-{customer-slug}` (e.g., `serviceflow-profix`)
3. Pick the region closest to the customer
4. Set a strong DB password — **save in 1Password / password manager**
5. Wait for provisioning (~2 min)
6. Go to **Settings → API**, copy:
   - **Project URL** → save as `SUPABASE_URL`
   - **service_role** key → save as `SUPABASE_SERVICE_ROLE_KEY` (secret!)

### 1.2 Run migrations

In Supabase SQL Editor, run migrations in order. Easiest: copy each file from `supabase/migrations/` and paste:

```
001_email_cases.sql
002_settings_and_pricing.sql
003_case_events.sql
004_admin_sessions.sql
005_data_retention_and_privacy.sql
006_smart_features.sql
007_calcom_booking.sql
008_draft_reply.sql
```

Verify in **Table Editor** that `email_cases`, `settings`, `pricing_items`, `case_events`, `admin_sessions`, `classification_feedback` tables exist.

### 1.3 Upstash Redis — new database

1. Go to [console.upstash.com](https://console.upstash.com) → **Create Database**
2. Name: `serviceflow-{customer-slug}`
3. Region: same as Supabase
4. Type: **Regional** (cheaper), TLS enabled
5. Copy the **TLS (rediss://) connection string** → save as `REDIS_URL`

---

## Phase 2: Gmail OAuth (10 min)

Follow [GMAIL_SETUP.md](GMAIL_SETUP.md) Steps 1-5 using **the customer's Gmail account**:

1. Create Google Cloud project (or reuse existing — customer can manage this themselves)
2. Enable Gmail API
3. Configure OAuth consent screen (add customer's email as test user)
4. Create OAuth2 credentials → save `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`
5. Generate refresh token via [OAuth Playground](https://developers.google.com/oauthplayground) using customer's Gmail → save `GMAIL_REFRESH_TOKEN`

Also note:
- `GMAIL_SEND_AS` = customer's business email (what appears on replies)

**Tip:** Let the customer do Steps 1-3 themselves so they own the Google Cloud project. You just need the 3 credentials.

---

## Phase 3: Railway deployment (10 min)

### 3.1 Create the web service

1. [Railway dashboard](https://railway.app) → **New Project** → **Deploy from GitHub repo**
2. Pick the ServiceFlow repo
3. Railway auto-detects the Dockerfile
4. Name the service: `serviceflow-{customer-slug}-web`

### 3.2 Add env vars

In Railway service → **Variables**, set:

```env
# Supabase (from Phase 1.1)
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Redis (from Phase 1.3)
REDIS_URL=rediss://default:...@xxx.upstash.io:6379

# Gmail (from Phase 2)
GMAIL_CLIENT_ID=...
GMAIL_CLIENT_SECRET=...
GMAIL_REFRESH_TOKEN=...
GMAIL_SEND_AS=service@customerbiz.com

# Anthropic (your shared key or customer's)
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-20250514

# Admin login (pick a strong password for the customer)
ADMIN_PASSWORD=<unique-strong-password>

# Optional — add after Cal.com webhook setup
# CALCOM_WEBHOOK_SECRET=

# Optional — add if customer wants SMS tech notifications
# TWILIO_ACCOUNT_SID=
# TWILIO_AUTH_TOKEN=
# TWILIO_FROM_NUMBER=

# Optional — Slack alerts
# SLACK_WEBHOOK_URL=
```

### 3.3 Deploy

Click **Deploy** (or push to master — both work). Railway builds the `app` stage.

### 3.4 Add the worker service (critical!)

The Dockerfile has two stages. The web service runs `app`, you also need a separate service running `worker`:

1. **New Service** → **Deploy from GitHub repo** (same repo)
2. Name: `serviceflow-{customer-slug}-worker`
3. **Settings → Build** → set **Docker Target** to `worker`
4. **Variables** → copy all env vars from the web service (Railway has a copy button)
5. **Deploy**

**Without the worker, Gmail polling doesn't run and no emails get processed.**

### 3.5 Set custom domain (optional)

Railway gives a URL like `serviceflow-xxx.up.railway.app`. To add a custom domain:

1. Web service → **Settings → Domains** → **Custom Domain**
2. Enter `app.customerbiz.com` or similar
3. Add the CNAME to customer's DNS
4. Railway provisions SSL automatically

---

## Phase 4: First-login configuration (5 min)

### 4.1 Verify health

Visit `https://their-domain/api/health` — should return 200 with `database: ok`, `redis: ok`.

### 4.2 Log in and configure

1. Go to `https://their-domain/login`
2. Use the `ADMIN_PASSWORD` from Phase 3.2
3. Go to **Settings** and fill in:
   - Business Information: name, phone, URL, location
   - Technician Contact: tech email + phone (if using notifications)
   - Booking Links: customer's actual Cal.com URLs
   - Automation Settings: confidence threshold, follow-up delays
   - Reply Mode: leave **off** (draft mode) for safe first week

### 4.3 Seed pricing

**Settings → Pricing tab** → add the customer's actual services and price ranges. Seeds from migration 002 are just examples.

### 4.4 Test end-to-end

1. Send a test email to the monitored inbox
2. Wait 2-3 minutes
3. Verify case appears in dashboard
4. Check status progresses: RECEIVED → CLASSIFIED → RESPONDED_PENDING_BOOKING
5. Open the case, verify draft reply looks sensible
6. Approve it, verify delivery to customer

---

## Phase 5: Cal.com integration (optional, 10 min)

If the customer uses Cal.com, follow [CALCOM_SETUP.md](CALCOM_SETUP.md):

1. Generate a webhook secret: `openssl rand -hex 32`
2. Add to Railway web service env: `CALCOM_WEBHOOK_SECRET`
3. Redeploy (Railway auto-restarts)
4. In Cal.com → Settings → Developer → Webhooks, add:
   - URL: `https://their-domain/api/webhooks/calcom`
   - Events: BOOKING_CREATED, BOOKING_RESCHEDULED, BOOKING_CANCELLED, MEETING_ENDED
   - Secret: same as env var

---

## Phase 6: Customer handoff (5 min)

### 6.1 Document for the customer

Send them:

- **Dashboard URL:** `https://their-domain`
- **Admin password:** (from password manager, share via secure channel)
- **Monitored inbox:** `service@theirbiz.com`
- **Reply mode status:** currently drafts go to Gmail drafts folder for review
- **Support:** your contact info + what to do if they see issues

### 6.2 What they need to monitor

- Gmail drafts folder (for replies pending their approval)
- Dashboard for new cases
- Sidebar status dot (green = healthy, red = check with you)

### 6.3 First-week coaching

- **Review every draft** for the first few days before approving — catch prompt tuning issues
- **Reclassify cases** that got the wrong intent so the feedback log builds up
- **Flip to auto-reply mode** (Settings → Reply Mode) after a week of clean drafts

---

## Post-launch monitoring

### Your checks (weekly):

- Railway logs: any errors on web or worker service?
- Supabase Usage page: approaching free tier limits?
- `/api/metrics` endpoint: classification confidence trending healthy?
- `/api/health`: all green?
- Anthropic dashboard: usage reasonable?

### Customer's checks (daily first week, then as needed):

- Dashboard case list: stuck cases in NEEDS_REVIEW?
- Gmail drafts folder: drafts older than 1 day pending review?
- Any missed emergencies (check ESCALATED filter)?

---

## Customer isolation checklist

Each customer has their own:

- [ ] Supabase project (physical DB separation)
- [ ] Upstash Redis database (job queue isolation)
- [ ] Railway web + worker services
- [ ] Gmail OAuth credentials (their inbox only)
- [ ] Admin password (unique, never shared)
- [ ] Anthropic API key (yours or theirs — decide upfront)
- [ ] Cal.com webhook secret (unique per customer)
- [ ] Twilio credentials (if using SMS, their account)
- [ ] Slack webhook (if using alerts, their workspace)

**Shared resources** (fine to share across customers):

- GitHub repo (code is identical; config is per-tenant via env vars)
- Your Anthropic API key if you're reselling inference
- Your Google Cloud OAuth app (optional — customers can BYO)

---

## Rough cost per customer

| Service | Tier | Monthly cost |
|---------|------|--------------|
| Railway web service | Hobby | $5 |
| Railway worker service | Hobby | $5 |
| Supabase | Free | $0 |
| Upstash Redis | Free | $0 |
| Anthropic API | Pay-as-you-go | $5-20 depending on volume |
| Gmail API | Free | $0 |
| Twilio SMS | Pay-per-message | $0-10 depending on volume |
| **Total** | | **~$15-40/customer/month** |

---

## Update workflow

When you push code to `master`:

1. Both Railway services (web + worker) auto-deploy for each customer's project
2. DB migrations are **not** auto-applied — run them manually in each customer's Supabase when adding new ones
3. New env vars are **not** auto-added — update each customer's Railway service manually

**Tip:** Keep a spreadsheet per customer with: Supabase URL, Railway project, active feature flags, custom env vars, contact info.

---

## Offboarding (if a customer leaves)

1. Export their data: `GET /api/privacy?email=all` or raw Supabase export
2. Hand off the export
3. Tear down: Railway services, Supabase project, Upstash DB
4. Revoke: Gmail OAuth tokens, Twilio creds, Cal.com webhook
5. Remove from your customer tracking spreadsheet
