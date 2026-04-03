# ServiceFlow — Development Roadmap

> Current state: feature-complete MVP with full intake-classify-route-reply-notify-follow-up pipeline, admin dashboard, and Docker deployment. This roadmap outlines suggested improvements organized by priority.

---

## Phase 1: Testing & Reliability (P0) — COMPLETE

### 1.1 Test Infrastructure
- [x] Set up Vitest with TypeScript support and native tsconfig path resolution
- [x] Reusable mock factories for Supabase, OpenAI, and Gmail (`src/test/mocks.ts`)
- [x] API test helpers for NextRequest/NextResponse (`src/test/api-helpers.ts`)
- [x] Add CI pipeline (GitHub Actions) for lint + type-check + test on every push/PR

### 1.2 Unit Tests (73 tests passing)
- [x] Service layer tests: classifier, router, pricing, case-event
- [x] Utility/lib tests: auth, config, gmail helpers, email templates
- [x] Zod schema validation tests (ClassificationSchema)

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
- [x] Circuit breaker for OpenAI calls (fallback to template-based replies when down)
- [x] Configurable timeouts on OpenAI (30s timeout, 2 SDK retries)
- [x] Slack retry logic (2 retries with 2s delay, skip retry on 4xx)
- [ ] SMTP fallback when Gmail API fails

### 3.2 Job Queue Hardening
- [x] Idempotency check in composer (re-verify before Gmail send to prevent duplicate sends)
- [x] Existing: gmail_message_id UNIQUE constraint prevents duplicate ingest
- [x] Existing: error alert queue for permanently failed jobs
- [ ] Queue depth alerting thresholds

### 3.3 Graceful Degradation
- [x] If classification fails after all retries, route to NEEDS_REVIEW (not stuck at RECEIVED)
- [x] If OpenAI is down, composer uses template-based fallback reply
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
- [ ] Versioned HTML email templates (stored in DB, editable via dashboard)
- [ ] Template preview in admin dashboard

### 5.3 Multi-Channel
- [ ] WhatsApp Business API integration for customer replies
- [ ] Push notifications for admin (mobile-friendly)
- [ ] Microsoft Teams integration (alternative to Slack)

**Status:** Shared email builder with List-Unsubscribe, plain-text fallback, and business hours scheduling. 4 duplicated `buildRawTextEmail` functions consolidated into one. 13 new tests.

---

## Phase 6: Data & Privacy (P2)

### 6.1 Data Retention
- [ ] Configurable retention policy (auto-archive cases after N days)
- [ ] Automated cleanup of expired sessions
- [ ] Soft-delete for cases (archive instead of hard delete)

### 6.2 Compliance
- [ ] GDPR data export (download all data for a customer email)
- [ ] Right-to-forget (purge all PII for a given email address)
- [ ] Consent tracking for automated replies
- [ ] Audit log for admin actions (already partially done via case_events)

### 6.3 Backups
- [ ] Automated daily database backups
- [ ] Backup verification and restore testing
- [ ] Point-in-time recovery documentation

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

### 8.1 Admin Dashboard
- [ ] Bulk actions (select multiple cases → close, reclassify, assign)
- [ ] Saved filters / custom views
- [ ] CSV/PDF export for cases and analytics
- [ ] Dark mode
- [ ] Mobile-responsive optimization
- [ ] Real-time updates (WebSocket or SSE for new cases)

### 8.2 Customer Portal
- [ ] Self-service status check (customer enters email → sees case status)
- [ ] Reschedule/cancel booking link
- [ ] Customer satisfaction survey after case close

### 8.3 Multi-Business Support
- [ ] Multi-tenant architecture (one instance serves multiple businesses)
- [ ] Business profiles with separate branding, pricing, and settings
- [ ] Per-business API keys and webhooks

### 8.4 Smart Features
- [ ] Classification feedback loop (admin corrections improve future accuracy)
- [ ] Smart scheduling (suggest times based on tech availability)
- [ ] Sentiment analysis on customer replies
- [ ] Repeat customer detection and history display
- [ ] Auto-tagging and categorization trends

### 8.5 Integrations
- [ ] Webhook system (notify external services on case events)
- [ ] Zapier / Make integration
- [ ] QuickBooks / invoice generation
- [ ] Google Calendar sync for booked appointments
- [ ] CRM integration (HubSpot, Salesforce)

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

## Summary

| Phase | Focus | Priority | Estimated Scope |
|-------|-------|----------|-----------------|
| 1 | Testing & Reliability | P0 | **COMPLETE** — 73 tests, CI pipeline |
| 2 | Security Hardening | P0 | **COMPLETE** — rate limiting, Zod validation, CSP headers, sanitization |
| 3 | Resilience & Error Handling | P1 | **COMPLETE** — circuit breaker, timeouts, idempotency, fallbacks |
| 4 | Monitoring & Observability | P1 | **COMPLETE** — metrics endpoint, PII masking, correlation IDs, queue health |
| 5 | Email & Communication | P1 | **COMPLETE** — shared email builder, List-Unsubscribe, plain-text fallback |
| 6 | Data & Privacy | P2 | Retention, GDPR, backups |
| 7 | Scaling & Performance | P2 | Pooling, caching, horizontal scale |
| 8 | Feature Enhancements | P2 | Bulk ops, customer portal, integrations |
| 9 | Documentation & DevEx | P3 | API spec, runbooks, dev tooling |
