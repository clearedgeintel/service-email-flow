# ServiceFlow

Email automation system for service businesses. Automatically ingests customer emails, classifies them with AI, routes by intent/urgency, sends professional HTML replies with pricing and booking links, notifies technicians, and follows up with unresponsive customers.

## Architecture

```
Gmail Inbox → Gmail Intake (cron) → Classifier (GPT-4o) → Router → Composer + Notifier
                                                                      ↓
                                                              Follow-Up (cron)
                                                              Digest (daily cron)
                                                              Error Alerts
```

**Two processes:**
- **Next.js app** — Admin dashboard + REST API (port 3000)
- **Worker process** — 8 BullMQ workers processing the email pipeline

**Stack:** Next.js 16, React, TypeScript, Tailwind CSS, BullMQ, Redis, Supabase (Postgres), OpenAI GPT-4o, Gmail API, Twilio, Slack

## Quick Start

### Prerequisites

- Node.js 20+
- Redis (local or hosted)
- Supabase project (or any Postgres)
- Gmail API OAuth2 credentials
- OpenAI API key

### 1. Install

```bash
git clone https://github.com/clearedgeintel/service-email-flow.git
cd service-email-flow
npm install
```

### 2. Configure

```bash
cp .env.local.example .env.local
# Edit .env.local with your credentials
```

### 3. Database

Run the SQL migrations in order against your Supabase/Postgres:

```
supabase/migrations/001_email_cases.sql
supabase/migrations/002_settings_and_pricing.sql
supabase/migrations/003_case_events.sql
supabase/migrations/004_admin_sessions.sql
```

### 4. Run

```bash
# Terminal 1 — Next.js app
npm run dev

# Terminal 2 — Background workers
npm run workers:dev
```

Open http://localhost:3000 and log in with your `ADMIN_PASSWORD`.

## Docker

```bash
# Create .env.local with your config, then:
docker compose up --build
```

This starts three containers:
- `app` — Next.js on port 3000
- `worker` — BullMQ workers
- `redis` — Redis 7

## Dashboard

| Page | URL | Description |
|------|-----|-------------|
| Cases | `/dashboard` | Filterable case queue with search, pagination |
| Case Detail | `/dashboard/cases/[id]` | Full case data, timeline, action buttons |
| Analytics | `/dashboard/analytics` | Volume charts, intent distribution, response times |
| Settings | `/dashboard/settings` | Business config + pricing table editor |

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/login` | No | Password login |
| POST | `/api/auth/logout` | Yes | Destroy session |
| GET | `/api/cases` | Yes | List cases (filterable) |
| GET | `/api/cases/[id]` | Yes | Case detail + timeline |
| PATCH | `/api/cases/[id]` | Yes | Update case fields |
| POST | `/api/cases/[id]/reclassify` | Yes | Re-run AI classification |
| POST | `/api/cases/[id]/resend-reply` | Yes | Resend customer email |
| POST | `/api/cases/[id]/escalate` | Yes | Escalate to emergency |
| POST | `/api/cases/[id]/close` | Yes | Close case |
| POST | `/api/cases/[id]/add-note` | Yes | Add admin note |
| POST | `/api/cases/[id]/trigger-followup` | Yes | Send follow-up now |
| GET | `/api/analytics` | Yes | Aggregated stats |
| GET/PUT | `/api/settings` | Yes | Config management |
| GET/POST | `/api/pricing` | Yes | Pricing items |
| PUT/DELETE | `/api/pricing/[id]` | Yes | Update/delete pricing |
| GET/POST | `/api/jobs` | Yes | Queue health + manual trigger |
| GET | `/api/health` | No | Health check (DB + Redis) |

## Workers

| Queue | Schedule | Description |
|-------|----------|-------------|
| gmail-intake | Every 2 min | Fetch unread Gmail, normalize, store |
| classifier | Event-driven | GPT-4o classification + extraction |
| router | Event-driven | Intent-based routing + Gmail labeling |
| composer | Event-driven | LLM reply generation + HTML email send |
| notifier | Event-driven | Tech SMS (Twilio) + email |
| followup | Every 15 min | Customer follow-up emails + escalation |
| digest | Daily 7:30 AM CT | Ops digest email + Slack alert |
| error-alert | On failure | Error notifications (Slack + email) |

## Environment Variables

See [.env.local.example](.env.local.example) for the full list with descriptions.

## Project Structure

```
src/
├── app/                  # Next.js pages + API routes
│   ├── api/              # 17 REST endpoints
│   ├── dashboard/        # Admin UI pages
│   └── login/            # Auth page
├── components/           # React components
├── lib/                  # Client modules (supabase, redis, openai, gmail, etc.)
├── services/             # Business logic (one per workflow)
├── types/                # TypeScript types + zod schemas
└── workers/              # BullMQ processors + bootstrap
supabase/migrations/      # 4 SQL migration files
```
