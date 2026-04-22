# ClearDesk — Development Roadmap

> ClearDesk by ClearEdge Intelligence — AI multi-channel customer-communication platform for service businesses. Email + Voice (Retell) + SMS (Twilio) with unified timeline, auto-reply, smart scheduling, outbound + inbound webhook integration, and Railway deployment.

## Status Snapshot (as of 2026-04-19)

- **257 tests passing across 33 test files** (unit + integration)
- **18 database migrations** applied
- **LLM:** Anthropic Claude Sonnet 4
- **Channels:** Email (Gmail), Voice (Retell AI inbound + outbound), SMS (Twilio inbound + outbound + auto-reply)
- **Deployed:** Railway (web + worker services, Redis plugin)
- **Phases complete:** 0, 1, 2, 3, 4, 5, 6, 8.1, 8.2, 8.4, 8.5, **10.1 (voice)**, **10.2 (n8n)**, **10.3 (SMS)**, **10.4 (voice analytics)**

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

### 10.1 Retell AI Voice Agent — COMPLETE
- [x] Retell SDK installed, settings-backed API key + agent IDs
- [x] DB migration 014: `calls` table (retell_call_id, case_id, direction, status,
  transcript, transcript_object, recording_url, sentiment, summary, custom_data)
- [x] Inbound call handler — `/api/webhooks/retell` signature-verified, rate limited
- [x] Link calls to existing cases by phone number (last-10-digit matching, open cases)
- [x] Create case from `call_analyzed` when no match — extracts caller_name, problem,
  trade, urgency, service_address from agent's custom_analysis_data
- [x] `call.started`, `call.ended`, `call.analyzed` events emit outbound webhooks
- [x] Settings → Retell AI Voice Agent section with enable toggle
- [x] `docs/RETELL_SETUP.md` with full agent configuration guide
- [x] Outbound callback — trigger a Retell call from the case detail page with live dynamic variables (business config, customer context)
- [x] Dashboard: `/dashboard/calls` paginated/filterable list; voice analytics in `/dashboard/analytics` (total, duration, voicemail rate, success rate, direction + sentiment breakdowns)
- [x] Store transcript as structured `VOICE_TRANSCRIPT` case event with speaker-labeled turns, rendered as chat bubbles in the timeline with inline audio
- [x] After-hours fallback: `business_hours_*` settings, `isAfterHours()` helper, `retell_after_hours_agent_id` override. Inbound calls flagged with `after_hours=true`; outbound blocked unless forced
- [x] Voice agent uses live business config via `retell_llm_dynamic_variables` — `call_inbound` webhook returns `business_name`, `business_phone`, `business_hours`, `is_after_hours`, `known_caller_name`

### 10.2 n8n Workflow Integration — COMPLETE
- [x] Generic webhook emission system (Phase 8.5) — DONE, all event types covered
- [x] Webhook config via Settings → Webhooks tab — DONE
- [x] HMAC-SHA256 signing on outgoing webhooks — DONE
- [x] Inbound n8n callback API: `POST /api/n8n/callback` with Bearer auth, discriminated-union action dispatcher (`add_note`, `update_status`, `close_case`, `trigger_followup`, `add_event`). Rate-limited. Emits matching outbound webhooks so workflows can chain
- [x] Dashboard API-key reveal/rotate at Settings → n8n Integration
- [x] Pre-built templates in `docs/n8n-workflows/`:
  - `01-slack-on-case-created.json` — Slack notification on `case.created`
  - `02-sms-tech-on-emergency.json` — Twilio SMS on `case.classified` + EMERGENCY, with callback logging `TECH_NOTIFIED`
  - `03-call-summary-email.json` — recap email on `call.ended`, with note callback
- [x] `docs/n8n-workflows/README.md` — setup, payload shapes, callback actions, security

### 10.3 SMS Channel (Twilio) — COMPLETE
- [x] DB migration 017: `sms_messages` table (twilio_sid, case_id, direction, status, body, media_urls, error_code, sent_at, delivered_at, received_at)
- [x] Inbound webhook `/api/webhooks/twilio/sms` — signature-verified, idempotent on MessageSid, handles MMS media URLs, returns empty TwiML
- [x] Status callback `/api/webhooks/twilio/status` — delivery-receipt updates on outbound rows
- [x] Outbound send from case detail: `POST /api/cases/[id]/send-sms` with chat-bubble composer in UI
- [x] Conversation history `GET /api/cases/[id]/messages`
- [x] `sms.received` + `sms.sent` outbound webhook events for n8n chaining
- [x] SMS auto-reply (migration 018) — on inbound, Claude drafts ≤320-char plain-text reply with SMS tone, 6-turn history context, business-hour emergency keyword handling, circuit-breaker fallback. Throttle (default 2 min) prevents storm loops. Off by default.
- [x] `docs/TWILIO_SMS_SETUP.md` — credentials, number config, status callbacks, troubleshooting

### 10.4 Voice Analytics — COMPLETE
- [x] Total calls, avg duration, voicemail rate, success rate stat cards
- [x] Direction (inbound/outbound) + sentiment (Positive/Neutral/Negative) breakdown bars
- [x] Voice section integrated into `/dashboard/analytics` alongside email metrics
- [ ] Cost tracking (Retell minutes × rate + Twilio SMS count × rate)

### 10.5 Unified UX — COMPLETE
- [x] Unified activity timeline on case detail — email/voice/SMS/workflow events interleave chronologically as typed cards (no more three-panel stack)
- [x] Channel-derived events deduped (raw rows take precedence over auto-logged events with matching IDs)
- [x] Unified search on case list — searches email fields + call transcripts + SMS bodies in parallel; results intersect with status/urgency/intent filters
- [x] Channel filter chips on case list (All / Email / Voice / SMS); source-channel icon next to case ID on each row
- [x] Pending drafts filter + amber indicator on case rows; pending-draft chip (filters to cases with `draft_reply` populated)
- [x] Dark mode on case detail page (all cards, modal, helper components)
- [x] Full-email-body view — expand/collapse toggle + raw/cleaned source toggle on the case body card

### 10.6 Combined Scenarios (deferred)
- [ ] Email → Callback: unclear/low-confidence email triggers Retell outbound call for clarification
- [ ] Emergency escalation chain: emergency email → tech SMS → no response in 5min → Retell outbound call → if still unreached → PagerDuty via n8n
- [ ] Channel preference: customer-level setting for preferred communication channel, overrides per-event channel choice

---

## Phase 11: Calendar Integration (provider-agnostic) (P2)

> Let admins see bookings + available slots + personal calendar in one view. Built around a `CalendarProvider` adapter interface so swapping or stacking Cal.com / Calendly / Google Calendar is a settings toggle, not a rewrite.

### 11.1 Calendar Tab — Cal.com (IN PROGRESS)
- [ ] `CalendarProvider` adapter interface: `listEvents(from, to)`, `listFreeSlots(from, to, eventTypeId?)`, optional `createBooking` + `verifyWebhook`
- [ ] Cal.com adapter implementing the interface — reuses existing `calcom.service` slot + booking logic
- [ ] New `/dashboard/calendar` route with week/month grid view
- [ ] Renders ClearDesk bookings (from `email_cases.booking_*`) as solid blocks, links back to the case
- [ ] Available Cal.com slots (per configured event type) rendered as faint outline blocks
- [ ] Sidebar nav entry: "Calendar" between Calls and Analytics
- [ ] Date range toggle (today / week / month); timezone respects `business_timezone` setting

### 11.2 Google Calendar Adapter (read-only)
- [ ] OAuth scope piggybacks on existing Gmail auth (add `calendar.readonly`)
- [ ] Google adapter: `listEvents` only (no slot booking), returns admin's personal busy blocks
- [ ] Calendar view overlays Google events as read-only "Busy (personal)" blocks so ClearDesk appointments don't conflict with your own calendar
- [ ] Settings → Calendar: per-provider enable toggles

### 11.3 Calendly Adapter
- [ ] Calendly v2 API integration (PAT-based auth)
- [ ] `listEvents` (booked events) + `listFreeSlots` (event type availability)
- [ ] Webhook receiver for Calendly invitee events (`invitee.created`, `invitee.canceled`) — links to cases by customer email match
- [ ] Settings → Calendly section (PAT, default event type, webhook signing secret)
- [ ] `docs/CALENDLY_SETUP.md`

### 11.4 Performance (only if needed)
- [ ] Local `calendar_events` cache table with provider + remote_id unique key
- [ ] Incremental sync worker (every N minutes) so the calendar view doesn't trigger 3× live API calls on every page load
- [ ] Deferred until measured latency is a problem

---

## Summary

| Phase | Focus | Priority | Estimated Scope |
|-------|-------|----------|-----------------|
| 0 | Core Pipeline | — | **COMPLETE** — 8 workers, analytics, settings, case actions |
| 1 | Testing & Reliability | P0 | **COMPLETE** — 257 tests across 33 files, CI pipeline |
| 2 | Security Hardening | P0 | **COMPLETE** — rate limiting, Zod validation, CSP headers, sanitization |
| 3 | Resilience & Error Handling | P1 | **COMPLETE** — circuit breaker, timeouts, idempotency, fallbacks |
| 4 | Monitoring & Observability | P1 | **COMPLETE** — metrics endpoint, PII masking, correlation IDs, queue health |
| 5 | Email & Communication | P1 | **COMPLETE** — shared email builder, List-Unsubscribe, plain-text fallback |
| 6 | Data & Privacy | P2 | **COMPLETE** — GDPR export/forget, retention, session cleanup |
| 7 | Scaling & Performance | P2 | Pooling, caching, horizontal scale |
| 8 | Feature Enhancements | P2 | **8.1 COMPLETE**, **8.2 COMPLETE** (customer portal), 8.3 multi-tenant (deferred), **8.4 COMPLETE** (smart scheduling), **8.5 COMPLETE** (Cal.com + webhooks) |
| 9 | Documentation & DevEx | P3 | API spec, runbooks, dev tooling |
| 10 | Multi-Channel (Voice + n8n + SMS + UX) | P2 | **10.1–10.5 COMPLETE** — Retell voice (in/out), n8n callback + templates, Twilio SMS + auto-reply, voice analytics, unified timeline + search + dark mode. 10.6 combined scenarios deferred |
| 11 | Calendar Integration (provider-agnostic) | P2 | Adapter interface + Cal.com (in progress), then Google (read-only overlay), then Calendly |
