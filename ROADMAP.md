# ServiceFlow — Development Roadmap

> ClearDesk by ClearEdge Intelligence — AI email automation for service businesses. Production-ready single-tenant platform with full email pipeline, admin dashboard, customer portal, Cal.com smart scheduling, outbound webhook system, and Railway deployment.

## Status Snapshot (as of 2026-04-15)

- **188 tests passing across 27 test files** (unit + integration)
- **13 database migrations** applied
- **LLM:** Anthropic Claude Sonnet 4
- **Deployed:** Railway (web + worker services, Redis plugin)
- **Phases complete:** 0, 1, 2, 3, 4, 5, 6, 8.1, 8.2, 8.4, 8.5

---

## Phase 0: Core Pipeline (shipped from day 1)

Core workflow that predates this roadmap:

- [x] Gmail intake worker (polls every 2 min, deduplicates by `gmail_message_id`)
- [x] AI classifier worker (Anthropic Claude, extracts intent, urgency, trade, customer info, sentiment)
- [x] Router worker (intent + confidence → status transition)
- [x] Composer worker (LLM-generated HTML reply, pricing table lookup, CTA selection)
- [x] Notifier worker (tech SMS via Twilio + email via Gmail API)
- [x] Followup worker (configurable delays, escalation on max attempts)
- [x] Digest worker (daily ops summary email + Slack)
- [x] Error alert worker (Slack + email on job failures)
- [x] Analytics dashboard (`/dashboard/analytics`) — case volume, response time, intent/urgency/trade breakdowns, stuck items
- [x] Settings dashboard (`/dashboard/settings`) — business info, tech contact, booking links, automation settings, pricing CRUD
- [x] Jobs API (`/api/jobs`) — queue health and manual job triggering
- [x] Case action endpoints: add-note, reclassify, resend-reply, escalate, close, trigger-followup, feedback, approve-reply, discard-reply
- [x] BullMQ + Redis (Upstash) job queue with retries and exponential backoff

---

## Phase 1: Testing & Reliability (P0) — COMPLETE

### 1.1 Test Infrastructure
- [x] Set up Vitest with TypeScript support and native tsconfig path resolution
- [x] Reusable mock factories for Supabase, Anthropic, and Gmail (`src/test/mocks.ts`)
- [x] API test helpers for NextRequest/NextResponse (`src/test/api-helpers.ts`)
- [x] Add CI pipeline (GitHub Actions) for lint + type-check + test on every push/PR

### 1.2 Unit Tests (166 tests across 25 files)
- [x] Service layer tests: classifier, router, pricing, case-event, smart, retention, calcom
- [x] Utility/lib tests: auth, config, gmail, gmail-labels, email-builder, email-template, circuit-breaker, logger, rate-limit, sanitize, validation
- [x] Zod schema validation tests (ClassificationSchema + all API route schemas)

### 1.3 Integration Tests
- [x] API route tests: login, health, cases (auth guard, filtering, pagination)
- [ ] Worker lifecycle tests (enqueue → process → complete)
- [ ] Additional API route tests (settings, pricing CRUD, analytics, case actions)

### 1.4 End-to-End Tests
- [ ] Playwright or Cypress for dashboard flows (login, case list, case detail actions)
- [ ] Full pipeline smoke test: ingest email → classify → route → reply

**Status:** 73 tests across 12 files. Core services and API routes covered. Remaining items are stretch goals for future iterations.

---

## Phase 2: Security Hardening (P0) — COMPLETE

### 2.1 Authentication
- [x] Add rate limiting on `/api/auth/login` (5 attempts/min per IP)
- [x] Zod input validation on login request body
- [ ] Secure session token rotation on each request
- [ ] Optional: MFA via TOTP (authenticator app)

### 2.2 Authorization
- [ ] Role-based access control (admin vs. read-only)
- [ ] API key auth for programmatic/webhook access
- [ ] Per-route permission checks

### 2.3 Input Validation
- [x] Enforce Zod validation on all API route inputs (cases, settings, pricing, login)
- [x] Sanitize HTML in email bodies before storage (`sanitizeHtml` + `escapeHtml`)
- [x] Add Content-Security-Policy and security headers (CSP, X-Frame-Options, XSS, Referrer-Policy)

### 2.4 Secrets Management
- [ ] Move secrets out of `.env` into a vault (e.g., Doppler, AWS Secrets Manager)
- [ ] Add secret rotation strategy for API keys and tokens
- [ ] Encrypt sensitive DB fields (phone numbers, API keys)

**Status:** Rate limiting, Zod validation, security headers, and HTML sanitization implemented with 33 new tests. Authorization and secrets management are stretch goals for future iterations.

---

## Phase 3: Resilience & Error Handling (P1) — COMPLETE

### 3.1 External API Resilience
- [x] Circuit breaker for LLM calls (Anthropic Claude Sonnet 4, fallback to template-based replies when down)
- [x] Configurable timeouts on LLM (30s timeout, 2 SDK retries)
- [x] Slack retry logic (2 retries with 2s delay, skip retry on 4xx)
- [ ] SMTP fallback when Gmail API fails

### 3.2 Job Queue Hardening
- [x] Idempotency check in composer (re-verify before Gmail send to prevent duplicate sends)
- [x] Existing: gmail_message_id UNIQUE constraint prevents duplicate ingest
- [x] Existing: error alert queue for permanently failed jobs
- [ ] Queue depth alerting thresholds

### 3.3 Graceful Degradation
- [x] If classification fails after all retries, route to NEEDS_REVIEW (not stuck at RECEIVED)
- [x] If LLM is down, composer uses template-based fallback reply
- [x] Existing: pricing lookup returns empty array on failure (reply sent without pricing)
- [x] Existing: Slack failures are non-blocking (fire-and-forget)

**Status:** Circuit breaker, timeouts, idempotency, Slack retries, and classifier fallback implemented with 5 new tests. SMTP fallback and queue depth alerts are stretch goals.

---

## Phase 4: Monitoring & Observability (P1) — COMPLETE

### 4.1 Metrics
- [x] `/api/metrics` endpoint with operational stats (cases, reply latency, confidence, errors)
- [x] Key metrics: reply latency, classification confidence, stuck cases, error events, intent distribution
- [x] Queue health monitoring in `/api/health` (waiting, active, failed counts per queue)

### 4.2 Logging
- [x] Correlation IDs (`generateCorrelationId`, `createCorrelatedLogger`)
- [x] PII masking in logs (emails masked to `jo***@domain.com`, phones masked to `+1555***4567`)
- [ ] Log aggregation setup (Datadog, Loki, or CloudWatch)

### 4.3 Alerting
- [x] Low confidence alert flag in metrics (`avg_confidence < 0.5` over 1hr)
- [x] Stuck cases metric (RECEIVED > 10min)
- [x] Error event count in metrics
- [ ] Uptime monitoring for health endpoint

### 4.4 SLO Dashboard
- [x] Reply latency tracked in metrics (`avg_reply_latency_ms`, readable format)
- [x] Classification confidence tracked in metrics
- [ ] Tech notification delivery success rate

**Status:** Metrics endpoint, PII masking, correlation IDs, queue health, and alerting signals implemented with 5 new tests. Log aggregation and external uptime monitoring are infrastructure-level stretch goals.

---

## Phase 5: Email & Communication (P1) — COMPLETE

### 5.1 Email Delivery
- [x] Add `List-Unsubscribe` and `List-Unsubscribe-Post` headers for compliance
- [x] Plain-text fallback for all HTML emails (multipart/alternative with auto-generated text)
- [x] Business hours utility (`isBusinessHours`, `nextBusinessHoursStart`) for scheduling
- [x] Shared `buildRawEmail` consolidating 4 duplicate implementations
- [ ] Bounce handling and delivery status tracking

### 5.2 Templates
- [x] Fallback templates when LLM is unavailable (Phase 3 circuit breaker)
- [x] DB-stored email templates (migration 010) with `{{var}}` substitution
  for LLM system prompt, follow-ups, and fallback replies
- [x] Template editor in Settings → Email Templates tab (view, edit, save per template)
- [ ] Version history for templates (rollback to prior versions)
- [ ] Live preview with sample variable values

### 5.3 Multi-Channel
- [ ] WhatsApp Business API integration for customer replies
- [ ] Push notifications for admin (mobile-friendly)
- [ ] Microsoft Teams integration (alternative to Slack)

**Status:** Shared email builder with List-Unsubscribe, plain-text fallback, and business hours scheduling. 4 duplicated `buildRawTextEmail` functions consolidated into one. 13 new tests.

---

## Phase 6: Data & Privacy (P2) — COMPLETE

### 6.1 Data Retention
- [x] Configurable retention policy (`retention_days` setting, `archiveOldCases()`)
- [x] Automated cleanup of expired sessions (`cleanupExpiredSessions()`)
- [x] Soft-delete for cases (`archived_at` column, archive instead of hard delete)
- [x] DB migration: `archived_at` column, customer email indexes, retention settings

### 6.2 Compliance
- [x] GDPR data export — `GET /api/privacy?email=...` returns all cases + events
- [x] Right-to-forget — `DELETE /api/privacy` anonymizes PII, deletes events
- [x] Audit log for admin actions (case_events table)
- [ ] Consent tracking for automated replies

### 6.3 Backups
- [ ] Automated daily database backups
- [ ] Backup verification and restore testing
- [ ] Point-in-time recovery documentation

**Status:** Retention service, GDPR export/forget APIs, session cleanup, and case archival implemented with 12 new tests. Backup automation is an infrastructure-level stretch goal.

---

## Phase 7: Scaling & Performance (P2)

### 7.1 Database
- [ ] Connection pooling (PgBouncer or Supabase pooler)
- [ ] Query performance monitoring (slow query log)
- [ ] Add missing indexes based on query patterns
- [ ] Cursor-based pagination (replace offset-based)

### 7.2 Caching
- [ ] Redis cache for frequently accessed cases and analytics
- [ ] Cache invalidation strategy for settings/pricing updates
- [ ] CDN for static dashboard assets

### 7.3 Horizontal Scaling
- [ ] Stateless session store (Redis-backed sessions)
- [ ] Multiple worker replicas with BullMQ concurrency
- [ ] Load balancer configuration (sticky sessions not required)
- [ ] Auto-scaling rules based on queue depth

---

## Phase 8: Feature Enhancements (P2)

### 8.1 Admin Dashboard — COMPLETE
- [x] Mobile-responsive optimization (collapsible sidebar, card view, touch targets)
- [x] Mailbox status indicator (sidebar + mobile header)
- [x] Hide closed cases by default (filter to show)
- [x] In-dashboard draft reply approval (preview, approve & send, discard)
- [x] Clickable timeline events with modal showing full metadata
- [x] Gmail label sync to case status (ServiceFlow/Received, Classified, etc.)
- [x] Draft vs auto-send reply mode toggle
- [x] Bulk actions (checkbox selection → close, escalate, reclassify)
- [x] Saved filters / custom views (localStorage-backed)
- [x] CSV export for cases (respects current filters, up to 10k rows)
- [x] Dark mode (class-based toggle, localStorage persistence)
- [x] Real-time updates (30s polling with "new cases available" banner)

### 8.2 Customer Portal — COMPLETE
- [x] Self-service status page at `/status/[token]` — tokenized, no auth required,
  branded ClearDesk page showing status, booking, timeline, problem summary
- [x] `case_access_tokens` table (migration 013) with auto-generate on reply send
- [x] Public API `GET /api/public/case/[token]` — rate limited, returns sanitized data
- [x] Composer injects `{{status_url}}` link in email footer: "Check your case status →"
- [x] Customer-friendly status labels and timeline event descriptions
- [ ] Reschedule deep-link from portal to Cal.com reschedule URL
- [ ] Customer satisfaction survey after case close

### 8.3 Multi-Business Support
- [ ] Multi-tenant architecture (one instance serves multiple businesses)
- [ ] Business profiles with separate branding, pricing, and settings
- [ ] Per-business API keys and webhooks

### 8.4 Smart Features — COMPLETE
- [x] Classification feedback loop (`POST /api/cases/:id/feedback` records corrections, tracks accuracy)
- [x] Sentiment analysis on customer emails (score -1.0 to 1.0 + label, extracted by OpenAI)
- [x] Repeat customer detection (`GET /api/customers` lists repeat customers with profiles)
- [x] Auto-tagging and categorization trends (`GET /api/trends` weekly intent/trade/urgency trends)
- [x] Smart scheduling — Cal.com `/v2/slots` integration, reply emails include
  3–5 tappable time buttons per intent/urgency (migration 011, cal-slots.service,
  email-template slot rendering, Settings → Smart Scheduling toggle + config)

### 8.5 Integrations
- [x] Cal.com webhook integration (booking tracking, auto-close on meeting end)
- [x] Generic outbound webhook system (migration 012, webhook.service,
  webhook-dispatch worker): admin-configured subscriptions receive HMAC-SHA256
  signed POSTs for `case.created`, `case.classified`, `case.routed`,
  `case.escalated`, `case.replied`, `case.booked`, `case.closed`,
  `case.note_added`. 4 retries with exponential backoff, delivery log,
  per-subscription test trigger, Settings → Webhooks tab
- [x] Zapier / Make integration — via the generic webhook system
- [ ] QuickBooks / invoice generation — via webhook → Zapier/n8n → QuickBooks
- [ ] Google Calendar sync for booked appointments
- [ ] CRM integration (HubSpot, Salesforce) — via webhook → Zapier/n8n → CRM

---

## Phase 9: Documentation & DevEx (P3)

### 9.1 Technical Docs
- [ ] Architecture diagram (system components, data flow)
- [ ] OpenAPI/Swagger spec for all API routes
- [ ] Database schema documentation (auto-generated from migrations)
- [ ] Deployment runbook (step-by-step production setup)

### 9.2 Operational Docs
- [ ] Troubleshooting guide (common issues and fixes)
- [ ] Incident response playbook
- [ ] On-call runbook for alerts

### 9.3 Developer Experience
- [ ] Contributing guidelines
- [ ] Local development setup script (one-command bootstrap)
- [ ] Seed data for development/demo
- [ ] Storybook for dashboard UI components

---

## Phase 10: Voice Agents & Workflow Automation (P2)

> Post-launch expansion: plug ServiceFlow into voice AI and low-code workflow automation to extend the pipeline beyond email.

### 10.1 Retell AI Voice Agent
- [ ] Retell AI account setup, API key, `CALL_WEBHOOK_SECRET` env var
- [ ] DB migration: `calls` table (case_id, retell_call_id, direction, status, started_at, ended_at, duration_seconds, transcript, recording_url)
- [ ] Inbound call handler — Twilio number forwards to Retell agent that collects caller info (name, problem, address, urgency) and creates a new case via API
- [ ] Outbound callback — trigger a Retell call for cases where clarification is needed (admin button or automated on low-confidence cases)
- [ ] Webhook route `/api/webhooks/retell` (signature-verified) for `call_started`, `call_ended`, `call_analyzed`
- [ ] Link calls to existing cases by phone number lookup, fall back to creating new case
- [ ] Store transcript as structured case event with speaker-labeled turns
- [ ] After-hours fallback: configured in Settings, missed calls route to voice agent
- [ ] Dashboard: call history panel on case detail showing transcript + recording link
- [ ] Voice agent uses same business info/pricing/booking URLs as email pipeline (shared settings)

### 10.2 n8n Workflow Integration
- [x] Generic webhook emission system (Phase 8.5) — DONE, all event types covered
- [x] Webhook config via Settings → Webhooks tab — DONE
- [x] HMAC-SHA256 signing on outgoing webhooks — DONE
- [ ] Pre-built n8n workflow templates in `docs/n8n-templates/`:
  - New case → Slack notification + HubSpot contact sync
  - Booking confirmed → Google Calendar event + SMS confirmation to tech
  - Case closed → customer satisfaction survey + QuickBooks invoice draft
  - Emergency → PagerDuty + phone call to on-call tech
- [ ] Incoming n8n callback API: `POST /api/n8n/action` lets n8n trigger ServiceFlow actions (close case, add note, escalate) with API key auth
- [ ] Documentation: `docs/N8N_SETUP.md` with self-host or cloud setup, example workflows

### 10.3 Combined Voice + Email + Workflow Scenarios
- [ ] Voice → Email → Booking: inbound call creates case, email pipeline sends confirmation with Cal.com link
- [ ] Email → Callback: unclear/low-confidence email triggers Retell agent to call customer for clarification
- [ ] Emergency escalation chain: emergency email → tech SMS → if no response in 5min → Retell outbound call → if still unreached → PagerDuty via n8n
- [ ] Unified timeline: case detail page shows email + voice + n8n-triggered events in one chronological view
- [ ] Channel preference: customer setting (stored per email) for preferred communication channel

### 10.4 Voice Analytics
- [ ] Call duration, hold time, resolution rate metrics
- [ ] Call transcript sentiment analysis (re-use existing sentiment classifier)
- [ ] Cost tracking (Retell + Twilio minutes used)

---

## Summary

| Phase | Focus | Priority | Estimated Scope |
|-------|-------|----------|-----------------|
| 0 | Core Pipeline | — | **COMPLETE** — 8 workers, analytics, settings, case actions |
| 1 | Testing & Reliability | P0 | **COMPLETE** — 166 tests, CI pipeline |
| 2 | Security Hardening | P0 | **COMPLETE** — rate limiting, Zod validation, CSP headers, sanitization |
| 3 | Resilience & Error Handling | P1 | **COMPLETE** — circuit breaker, timeouts, idempotency, fallbacks |
| 4 | Monitoring & Observability | P1 | **COMPLETE** — metrics endpoint, PII masking, correlation IDs, queue health |
| 5 | Email & Communication | P1 | **COMPLETE** — shared email builder, List-Unsubscribe, plain-text fallback |
| 6 | Data & Privacy | P2 | **COMPLETE** — GDPR export/forget, retention, session cleanup |
| 7 | Scaling & Performance | P2 | Pooling, caching, horizontal scale |
| 8 | Feature Enhancements | P2 | **8.1 COMPLETE**, **8.2 COMPLETE** (customer portal), 8.3 multi-tenant (deferred), **8.4 COMPLETE** (smart scheduling), **8.5 COMPLETE** (Cal.com + webhooks) |
| 9 | Documentation & DevEx | P3 | API spec, runbooks, dev tooling |
| 10 | Voice Agents & Workflow Automation | P2 | 10.1 Retell AI voice (next), 10.2 n8n core done via webhook system, templates + callback API remaining |
