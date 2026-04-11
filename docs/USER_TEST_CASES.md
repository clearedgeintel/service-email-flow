# ServiceFlow — User Test Cases

> Manual test cases covering the major user-facing flows. Run these before each release and after any significant change. Each test has preconditions, steps, and expected results. Check the box when verified.

**Test environment setup:**
- [ ] Supabase project connected with migrations 001-008 applied
- [ ] Redis (Upstash or local) running
- [ ] Workers running: `npm run workers`
- [ ] Dev server running: `npm run dev`
- [ ] `.env.local` configured with Gmail, Anthropic, admin password
- [ ] Test Gmail account configured with OAuth refresh token

---

## 1. Authentication

### TC-AUTH-01: Successful login
**Precondition:** `ADMIN_PASSWORD=admin` in `.env.local`.
**Steps:**
1. Navigate to `/login`
2. Enter password `admin`
3. Click Sign In

**Expected:** Redirected to `/dashboard`. Session cookie `sf_session` set.
- [ ] Pass

### TC-AUTH-02: Wrong password
**Steps:**
1. Navigate to `/login`
2. Enter incorrect password
3. Click Sign In

**Expected:** Error message "Invalid password". Stays on login page.
- [ ] Pass

### TC-AUTH-03: Rate limit on login
**Steps:**
1. Navigate to `/login`
2. Enter wrong password 6 times in under a minute

**Expected:** On the 6th attempt, receives 429 "Too many requests" error.
- [ ] Pass

### TC-AUTH-04: Logout
**Precondition:** Logged in.
**Steps:**
1. Click **Sign Out** in sidebar
2. Confirm redirect to `/login`

**Expected:** Session cleared. Navigating back to `/dashboard` redirects to login.
- [ ] Pass

### TC-AUTH-05: Session persistence
**Precondition:** Logged in.
**Steps:**
1. Close browser tab
2. Reopen `/dashboard`

**Expected:** Still logged in (session cookie persists 24h).
- [ ] Pass

---

## 2. Gmail Intake Pipeline

### TC-INTAKE-01: Email ingestion
**Precondition:** Workers running. Gmail inbox empty of unread messages.
**Steps:**
1. Send a test email to the monitored inbox with subject "Test repair request"
2. Wait up to 2 minutes

**Expected:**
- New case appears in `/dashboard`
- Case has `RECEIVED` status
- Gmail message is marked as read
- Gmail message has `ServiceFlow/Received` label
- [ ] Pass

### TC-INTAKE-02: Classification
**Precondition:** Case in `RECEIVED` state from TC-INTAKE-01.
**Steps:**
1. Wait for classifier worker to process (~5-15 seconds)
2. Refresh `/dashboard`

**Expected:**
- Case status changes to `CLASSIFIED` (or `NEEDS_REVIEW` if confidence < 0.7)
- Intent, urgency, trade, sentiment fields populated
- Gmail label swapped to `ServiceFlow/Classified`
- Timeline shows `CLASSIFIED` event with confidence score
- [ ] Pass

### TC-INTAKE-03: Routing decision
**Precondition:** Case classified with high confidence.
**Steps:**
1. Open case detail
2. Check Timeline

**Expected:**
- `ROUTED` event appears with `new_status` metadata
- Status transitions (e.g., `CLASSIFIED` → `RESPONDED_PENDING_BOOKING` for repair requests)
- Gmail label matches new status
- [ ] Pass

### TC-INTAKE-04: Emergency escalation
**Steps:**
1. Send test email: "URGENT - gas leak in my kitchen, smelling gas right now"
2. Wait for pipeline to process

**Expected:**
- Case classified as `EMERGENCY` intent with `EMERGENCY` urgency
- Status → `ESCALATED`
- `requires_tech_notify: true` and `requires_customer_reply: true`
- Gmail label: `ServiceFlow/Escalated`
- Reply sent immediately (bypasses draft mode)
- [ ] Pass

### TC-INTAKE-05: Spam detection
**Steps:**
1. Send test email: "CONGRATULATIONS YOU WON A FREE VACATION CLICK HERE"

**Expected:**
- Classified as `SPAM`
- Status → `CLOSED`
- Gmail label: `ServiceFlow/Closed`
- [ ] Pass

---

## 3. Reply Composition

### TC-REPLY-01: Draft mode (default)
**Precondition:** `auto_reply = false` in Settings.
**Steps:**
1. Ingest a new repair request email
2. Wait for composer to process
3. Open case detail

**Expected:**
- Amber "Pending Draft Reply" card appears
- Contains customer name greeting, problem summary acknowledgment, CTA button wording, closing
- "Approve & Send" and "Discard" buttons visible
- Draft also visible in Gmail drafts folder
- [ ] Pass

### TC-REPLY-02: Draft HTML preview toggle
**Precondition:** Case with pending draft from TC-REPLY-01.
**Steps:**
1. On draft card, click "Show HTML preview"

**Expected:** Rendered HTML shows with branding, CTA button, optional pricing table. Toggles back to plain text with "Show text".
- [ ] Pass

### TC-REPLY-03: Approve draft
**Precondition:** Case with pending draft.
**Steps:**
1. Click **Approve & Send**

**Expected:**
- Draft card disappears
- Case `customer_reply_sent` = true
- Status → `RESPONDED_PENDING_BOOKING`
- Gmail label: `ServiceFlow/Responded`
- Timeline event: "Draft approved and sent by admin"
- Email actually delivered to customer
- [ ] Pass

### TC-REPLY-04: Discard draft
**Precondition:** Case with pending draft.
**Steps:**
1. Click **Discard**

**Expected:**
- Draft cleared from DB
- Gmail draft deleted
- Timeline event: "Draft reply discarded by admin"
- [ ] Pass

### TC-REPLY-05: Auto-reply mode
**Steps:**
1. Settings → Reply Mode → toggle auto-reply **ON**
2. Save settings
3. Ingest a new repair request email

**Expected:** Reply sent immediately without draft. Case `customer_reply_sent=true` right after composer runs.
- [ ] Pass

### TC-REPLY-06: Emergency bypasses draft mode
**Precondition:** `auto_reply = false`.
**Steps:**
1. Ingest an emergency email (gas leak)

**Expected:** Reply sent immediately despite draft mode being off (emergencies always auto-send).
- [ ] Pass

---

## 4. Case Dashboard

### TC-DASH-01: Case list loads
**Precondition:** At least 1 non-closed case exists.
**Steps:**
1. Navigate to `/dashboard`

**Expected:** Table shows cases with ID, customer, subject, status, intent, urgency, received timestamp. Closed cases are hidden by default.
- [ ] Pass

### TC-DASH-02: Filters
**Steps:**
1. Click **Filters**
2. Select Status: `ESCALATED`
3. Select Intent: `EMERGENCY`

**Expected:** List updates to show only matching cases. URL contains query params.
- [ ] Pass

### TC-DASH-03: Search
**Steps:**
1. Type a customer name in search box
2. Press Enter

**Expected:** Results filtered by name/email/subject match.
- [ ] Pass

### TC-DASH-04: Pagination
**Precondition:** More than 25 cases exist.
**Steps:**
1. Click Next page arrow

**Expected:** Shows next 25 cases. URL has `page=2`.
- [ ] Pass

### TC-DASH-05: Real-time polling banner
**Steps:**
1. Keep `/dashboard` open
2. Send a new email to the monitored inbox
3. Wait up to 30 seconds + intake interval

**Expected:** Blue banner appears: "X new cases available — click to refresh". Clicking refreshes the list.
- [ ] Pass

### TC-DASH-06: Show closed cases
**Steps:**
1. Click Filters
2. Select Status: `CLOSED`

**Expected:** Previously hidden closed cases now visible.
- [ ] Pass

---

## 5. Bulk Actions

### TC-BULK-01: Select and close multiple
**Precondition:** At least 3 non-closed cases.
**Steps:**
1. Check 3 cases via checkboxes
2. Click **Close** in blue action bar
3. Confirm prompt

**Expected:** All 3 cases transition to `CLOSED`. Bar disappears. Cases removed from default view.
- [ ] Pass

### TC-BULK-02: Select all
**Steps:**
1. Click header checkbox

**Expected:** All visible cases selected. Bar shows count.
- [ ] Pass

### TC-BULK-03: Bulk escalate
**Steps:**
1. Select 2 non-emergency cases
2. Click **Escalate**

**Expected:** Both cases → `ESCALATED`, `urgency_level=EMERGENCY`. Gmail labels updated.
- [ ] Pass

### TC-BULK-04: Bulk reclassify
**Steps:**
1. Select 1 classified case
2. Click **Reclassify**

**Expected:** Case reset to `RECEIVED`, re-enqueued for classification. Wait for classifier to reprocess.
- [ ] Pass

---

## 6. CSV Export

### TC-EXPORT-01: Export current view
**Steps:**
1. Apply filter: status = `ESCALATED`
2. Click **Export** button

**Expected:** Browser downloads `cases-YYYY-MM-DD.csv`. Opens in Excel/Sheets with 19 columns. Only escalated cases included.
- [ ] Pass

### TC-EXPORT-02: Export respects search
**Steps:**
1. Search for a specific customer name
2. Click **Export**

**Expected:** CSV only contains matching cases.
- [ ] Pass

---

## 7. Saved Filters

### TC-SAVED-01: Save current filter
**Steps:**
1. Open Filters panel
2. Set Status=`NEEDS_REVIEW`, Intent=`REPAIR_REQUEST`
3. Click **+ Save current**
4. Enter name "Review queue"
5. Click Save

**Expected:** Chip "Review queue" appears in Saved row.
- [ ] Pass

### TC-SAVED-02: Load saved filter
**Steps:**
1. Clear filters
2. Click the "Review queue" chip

**Expected:** Filters restored to Status=`NEEDS_REVIEW`, Intent=`REPAIR_REQUEST`.
- [ ] Pass

### TC-SAVED-03: Delete saved filter
**Steps:**
1. Click × on the "Review queue" chip

**Expected:** Chip removed. Filter no longer saved in localStorage.
- [ ] Pass

---

## 8. Case Detail View

### TC-DETAIL-01: Full case view
**Steps:**
1. Click a case from the list

**Expected:** Shows customer info, problem summary, email body, notes, timeline, actions sidebar, metadata sidebar.
- [ ] Pass

### TC-DETAIL-02: Add note
**Steps:**
1. Type a note in the notes input
2. Press Enter or click Add

**Expected:** Note appended to case notes. Timeline event `NOTE_ADDED`.
- [ ] Pass

### TC-DETAIL-03: Timeline event click
**Steps:**
1. Click any timeline event row

**Expected:** Modal opens showing full event type, timestamp, actor, summary, and pretty-printed metadata JSON. × closes modal.
- [ ] Pass

### TC-DETAIL-04: Reclassify action
**Steps:**
1. Click **Reclassify**

**Expected:** Case resets to `RECEIVED`, re-processed by classifier. Status changes back after worker runs.
- [ ] Pass

### TC-DETAIL-05: Manual escalate
**Steps:**
1. Click **Escalate** in Actions sidebar

**Expected:** Status → `ESCALATED`, urgency → `EMERGENCY`, tech notify enqueued. Gmail label updated.
- [ ] Pass

### TC-DETAIL-06: Manual close
**Steps:**
1. Click **Close Case**

**Expected:** Status → `CLOSED`. Gmail label `ServiceFlow/Closed`. Case disappears from default list.
- [ ] Pass

### TC-DETAIL-07: Trigger follow-up
**Precondition:** Case in `RESPONDED_PENDING_BOOKING` that has been replied to.
**Steps:**
1. Click **Trigger Follow-up**

**Expected:** Follow-up email sent. `followup_count` incremented. Timeline shows `FOLLOWUP_SENT`.
- [ ] Pass

---

## 9. Classification Feedback

### TC-FEEDBACK-01: Correct classification via PATCH
**Steps:**
1. Open a misclassified case
2. Use the API or edit to change intent/urgency/trade
3. Check `classification_feedback` table in Supabase

**Expected:** Feedback row inserted tracking original vs corrected values. *(Note: UI for this is API-only currently — `POST /api/cases/:id/feedback`.)*
- [ ] Pass

---

## 10. Cal.com Booking Integration

### TC-CALCOM-01: Webhook signature verification
**Precondition:** `CALCOM_WEBHOOK_SECRET` set in `.env.local`.
**Steps:**
1. Send a POST to `/api/webhooks/calcom` with wrong `x-cal-signature-256` header

**Expected:** 401 Invalid signature.
- [ ] Pass

### TC-CALCOM-02: BOOKING_CREATED event
**Steps:**
1. Have an open case with customer email `test@example.com`
2. Send a POST to `/api/webhooks/calcom` with valid signature and BOOKING_CREATED payload containing that email

**Expected:** Case updated with `booking_id`, `booking_status='booked'`, `booking_start_at`. Case detail shows green "Appointment Booked" card.
- [ ] Pass

### TC-CALCOM-03: BOOKING_CANCELLED event
**Precondition:** Case from TC-CALCOM-02.
**Steps:**
1. Send BOOKING_CANCELLED webhook for the same booking UID with a cancellation reason

**Expected:** Booking card turns red, shows reason. Status → `NEEDS_REVIEW`.
- [ ] Pass

### TC-CALCOM-04: MEETING_ENDED auto-closes case
**Steps:**
1. Send MEETING_ENDED webhook for a booked case

**Expected:** `booking_status='completed'`. Status → `CLOSED`.
- [ ] Pass

---

## 11. Settings

### TC-SETTINGS-01: Edit business info
**Steps:**
1. Go to Settings → Business Information
2. Change Business Name
3. Click Save Settings

**Expected:** Green "Saved!" indicator. Next customer reply uses new business name in header.
- [ ] Pass

### TC-SETTINGS-02: Toggle reply mode
**Steps:**
1. Settings → Reply Mode
2. Toggle switch

**Expected:** Description text updates. Save persists change. New emails honor the mode.
- [ ] Pass

### TC-SETTINGS-03: Add pricing item
**Steps:**
1. Settings → Pricing tab
2. Fill in trade, service, keywords, min/max price
3. Click Add

**Expected:** New row appears. Saved to `pricing_items` table.
- [ ] Pass

### TC-SETTINGS-04: Delete pricing item
**Steps:**
1. Click trash icon on a pricing row

**Expected:** Row removed (soft delete — `active=false`).
- [ ] Pass

### TC-SETTINGS-05: Resync Gmail labels
**Precondition:** Several existing cases.
**Steps:**
1. Settings → Gmail Labels → **Resync all labels**
2. Confirm prompt
3. Wait for completion

**Expected:** Status text shows "Synced X / Y cases". Each case's Gmail message now has the correct `ServiceFlow/*` label.
- [ ] Pass

---

## 12. Dark Mode

### TC-DARK-01: Toggle dark mode
**Steps:**
1. Click **Dark Mode** in sidebar

**Expected:** Background transitions to dark. Sidebar text color adjusts. Cases list, detail page, and settings all render in dark theme.
- [ ] Pass

### TC-DARK-02: Dark mode persistence
**Precondition:** Dark mode enabled.
**Steps:**
1. Refresh page

**Expected:** Dark mode still active (no flash of light mode).
- [ ] Pass

### TC-DARK-03: Toggle back to light
**Steps:**
1. Click **Light Mode**

**Expected:** Returns to light theme. Persists on refresh.
- [ ] Pass

---

## 13. Mobile View

### TC-MOBILE-01: Mobile sidebar
**Steps:**
1. Open dashboard on mobile or resize to <768px
2. Click hamburger menu in top bar

**Expected:** Side drawer slides in with nav and mailbox status. Overlay dims background. Tapping outside or × closes it.
- [ ] Pass

### TC-MOBILE-02: Case cards on mobile
**Steps:**
1. View `/dashboard` at mobile width

**Expected:** Cases shown as stacked cards instead of table. Each card has customer name, subject, status badges, timestamp. Tapping card navigates to detail.
- [ ] Pass

### TC-MOBILE-03: Mobile header mailbox status
**Steps:**
1. View top bar on mobile

**Expected:** Green/red status dot + truncated mailbox email visible next to hamburger.
- [ ] Pass

---

## 14. System Health

### TC-HEALTH-01: Health endpoint
**Steps:**
1. Navigate to `/api/health` (no auth needed)

**Expected:** JSON with `database: ok`, `redis: ok`, and `queues` object with waiting/active/failed counts per queue.
- [ ] Pass

### TC-HEALTH-02: Metrics endpoint
**Precondition:** Logged in.
**Steps:**
1. Navigate to `/api/metrics`

**Expected:** JSON with `cases`, `performance`, `classification`, `errors` sections. Reply latency, avg confidence, stuck case count.
- [ ] Pass

### TC-HEALTH-03: Mailbox status indicator
**Steps:**
1. Check sidebar status indicator

**Expected:** Green dot + monitored email address. Updates every 60s.
- [ ] Pass

### TC-HEALTH-04: Degraded state
**Steps:**
1. Stop Redis
2. Wait up to 60s

**Expected:** Status indicator turns red. `/api/health` returns 503.
- [ ] Pass

---

## 15. Privacy / GDPR

### TC-PRIVACY-01: Export customer data
**Steps:**
1. Call `GET /api/privacy?email=customer@example.com` (authenticated)

**Expected:** JSON response with all cases and events for that email. Exported timestamp included.
- [ ] Pass

### TC-PRIVACY-02: Right to forget
**Steps:**
1. Call `DELETE /api/privacy` with body `{"email": "customer@example.com"}`

**Expected:** All cases anonymized (`from_email=redacted@redacted.com`, `[REDACTED]` in name/body). Case events deleted. Response shows count.
- [ ] Pass

---

## 16. Resilience

### TC-RESILIENCE-01: OpenAI/Anthropic down — composer fallback
**Steps:**
1. Set `ANTHROPIC_API_KEY` to an invalid value
2. Restart dev server and workers
3. Ingest a new email

**Expected:** Circuit breaker trips after 3 failures. Subsequent cases use template-based fallback reply. Case event metadata shows `used_fallback: true`.
- [ ] Pass

### TC-RESILIENCE-02: Classifier final-attempt fallback
**Precondition:** Anthropic API failing.
**Steps:**
1. Ingest a new email
2. Wait for 3 classifier retries to exhaust

**Expected:** Case routed to `NEEDS_REVIEW` (not stuck at RECEIVED). Notes show "Classification failed after retries".
- [ ] Pass

### TC-RESILIENCE-03: Duplicate email deduplication
**Steps:**
1. Ingest an email (case created)
2. Delete the case row from DB
3. Mark the Gmail message as unread
4. Wait for next intake cycle

**Expected:** Email re-ingested as new case (dedup is by `gmail_message_id` UNIQUE constraint).
- [ ] Pass

---

## 17. Security

### TC-SEC-01: Unauthenticated API access blocked
**Steps:**
1. Without login cookie, call `GET /api/cases`

**Expected:** 401 Unauthorized.
- [ ] Pass

### TC-SEC-02: Invalid Zod input rejected
**Steps:**
1. Call `POST /api/cases/1/add-note` with `{"note": ""}`

**Expected:** 400 Bad Request with validation error.
- [ ] Pass

### TC-SEC-03: Security headers present
**Steps:**
1. Inspect any page response headers

**Expected:**
- `Content-Security-Policy` present
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- [ ] Pass

### TC-SEC-04: HTML sanitization on intake
**Steps:**
1. Send an email containing `<script>alert('xss')</script>` in the body

**Expected:** `body_raw` in DB has script tags stripped. No execution on display.
- [ ] Pass

---

## Release Checklist

Before marking a release ready:

- [ ] All TC-AUTH tests pass
- [ ] Full pipeline (TC-INTAKE-01 → TC-REPLY-03) works end-to-end
- [ ] Dashboard navigation and filters work
- [ ] Bulk actions complete successfully
- [ ] CSV export downloads correctly
- [ ] Cal.com webhook integration (if configured)
- [ ] Dark mode and mobile views render correctly
- [ ] `npm run test:run` — all unit/integration tests pass
- [ ] `npm run build` — production build succeeds
- [ ] `npm run type-check` — no TypeScript errors
- [ ] `npm run lint` — no linting errors

---

## Bug Report Template

When a test fails, capture:

```
Test ID: TC-XXX-##
Title: <test title>
Date: YYYY-MM-DD
Environment: dev | staging | prod
Browser: Chrome/Firefox/Safari + version
Steps to reproduce: <exact steps>
Expected: <what should happen>
Actual: <what did happen>
Screenshot/log: <if applicable>
```

File as GitHub issue with label `bug` and priority.
