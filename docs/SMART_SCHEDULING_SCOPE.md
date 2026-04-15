# Smart Scheduling — Scope

> Inject actual Cal.com availability into reply emails so customers can tap a specific time instead of navigating Cal.com's full picker.

## Goal

When ClearDesk generates a reply for a REPAIR_REQUEST, SALES_INQUIRY, or EMERGENCY case, the email body should include **3–5 real available time slots** pulled from Cal.com, each as a tappable deep-link that pre-fills that slot in Cal.com. Customer taps once, confirms in Cal.com, booking webhook fires (existing flow).

## Customer experience

**Before (today):**
> Thanks for reaching out! Click the button below to book a time that works for you.  
> **[📅 Book a Service Call]**

**After:**
> Thanks for reaching out! Here are the next available times:
>
> - **Thu, Apr 17 · 9:00 AM**
> - **Thu, Apr 17 · 2:00 PM**
> - **Fri, Apr 18 · 10:00 AM**
>
> *Prefer a different time?* [See all available times →]

---

## API reference

**Endpoint:** `GET https://api.cal.com/v2/slots`

**Auth:** `Authorization: Bearer <CALCOM_API_KEY>` + required header `cal-api-version: 2024-09-04`

**Query params:**
- `eventTypeId` (int, required) — which Cal.com event type to query
- `start` (ISO 8601, required) — start of range (e.g., `2026-04-16`)
- `end` (ISO 8601, required) — end of range
- `timeZone` (optional) — e.g., `America/Chicago`
- `duration` (optional) — minutes

**Response:**
```json
{
  "status": "success",
  "data": {
    "2026-04-17": [
      "2026-04-17T09:00:00.000-05:00",
      "2026-04-17T14:00:00.000-05:00"
    ],
    "2026-04-18": ["2026-04-18T10:00:00.000-05:00"]
  }
}
```

**Deep-link format for pre-filled booking:**
```
https://cal.com/<username>/<event-slug>?date=2026-04-17&month=2026-04&slot=2026-04-17T09:00:00.000-05:00
```

---

## Implementation

### 1. New settings

Three additions to the Settings dashboard (and settings seed):

| Key | Type | Purpose |
|-----|------|---------|
| `calcom_api_key` | string | Cal.com API bearer token |
| `calcom_event_type_emergency` | number | Event type ID for emergencies |
| `calcom_event_type_service` | number | Event type ID for repair service calls |
| `calcom_event_type_estimate` | number | Event type ID for sales/estimate consults |
| `business_timezone` | string | IANA timezone (e.g., `America/Chicago`), defaults to `America/Chicago` |
| `slot_suggestion_days` | number | How many days out to query (default 7) |
| `slot_suggestion_count` | number | How many slots to show in email (default 3) |

User can get event type IDs from Cal.com dashboard → Event Types → edit → URL shows ID.

### 2. New service: `src/services/cal-slots.service.ts`

```typescript
interface SlotOption {
  iso: string;           // "2026-04-17T09:00:00.000-05:00"
  date_display: string;  // "Thu, Apr 17"
  time_display: string;  // "9:00 AM"
  booking_url: string;   // pre-filled Cal.com URL
}

async function fetchAvailableSlots(params: {
  eventTypeId: number;
  calcomUrl: string;     // full base URL to event type (from settings)
  timezone: string;
  daysAhead: number;
  maxSlots: number;
}): Promise<SlotOption[]>
```

- Queries `/v2/slots` with a 5-second timeout
- Flattens the date-keyed response into a chronological list
- Takes the top N (respecting business hours by trusting Cal.com's config)
- Builds booking URL with `?date=...&slot=...` params
- Formats `date_display` and `time_display` using `Intl.DateTimeFormat` in the business timezone
- Returns empty array on failure (graceful degradation)

**Caching:** optional 5-minute in-memory cache keyed by `(eventTypeId, start, end, timezone)` to avoid hammering Cal.com when multiple emails arrive at once.

### 3. Composer integration

In `src/services/composer.service.ts`:
- Call `fetchAvailableSlots` after determining `calcomUrl`/`calcomLabel`
- Pass the slots to both:
  - **The LLM user prompt** — as additional context so the AI can reference "I have 3 times open"
  - **The HTML email template** — to render the slot buttons

Behavior when Cal.com API fails (no key configured, network error, no slots returned):
- Silently skip the slot section
- Keep the existing "Book a time" button and generic URL
- Log warning in poll/case events for debugging

### 4. HTML email template

Extend `src/lib/email-template.ts`:
- Add optional `slotOptions?: SlotOption[]` param to `buildHtmlEmail`
- When provided, render a vertical stack of 3–5 buttons above the existing "See all times" button
- Each button styled as a rounded pill with the brand blue
- Responsive: stacks on mobile, max width 500px

Sketch:
```html
<div style="margin: 20px 0;">
  <p style="font-weight: 600; margin-bottom: 12px;">Available times:</p>
  <a href="...?slot=..." style="display: block; padding: 12px; border: 1px solid #185FA5; border-radius: 8px; margin-bottom: 8px; text-decoration: none; color: #185FA5;">
    <strong>Thu, Apr 17</strong> · 9:00 AM
  </a>
  <!-- repeat for each slot -->
  <a href="{calcomUrl}" style="text-align: center; display: block; color: #666; text-decoration: underline;">See all available times →</a>
</div>
```

### 5. Plain-text fallback

`htmlToPlainText` in `src/lib/email-builder.ts` already handles this via the auto-generated plain-text part of the multipart email. Slot links render as `Thu, Apr 17 · 9:00 AM (https://cal.com/...)`.

### 6. Template variable

Add `{{available_slots_text}}` variable to the composer system prompt so admins can tell the LLM how to reference slot availability in the generated copy (e.g., "mention that we have openings this week").

Rendered as a newline-separated list:
```
- Thu, Apr 17 at 9:00 AM
- Thu, Apr 17 at 2:00 PM
- Fri, Apr 18 at 10:00 AM
```

Empty string if no slots available.

### 7. Tests

- `cal-slots.service.test.ts` — mock fetch response, verify slot parsing, URL building, timezone formatting, error handling
- `email-template.test.ts` — verify slot HTML renders correctly when options provided, unchanged when not

### 8. Dashboard changes

Settings → Configuration tab → new "Smart Scheduling" section:
- Cal.com API Key (password field)
- Emergency Event Type ID (number)
- Service Event Type ID (number)
- Estimate Event Type ID (number)
- Business Timezone (dropdown of IANA names)
- Slot suggestion days (number, default 7)
- Slot suggestion count (number, default 3, max 5)

Show a small "Test connection" button that fetches slots for the next 24h with the configured service event type, confirms the API key works.

### 9. Documentation

New `docs/SMART_SCHEDULING_SETUP.md`:
- How to create an API key in Cal.com
- How to find event type IDs
- How to set up event types (emergency, service call, estimate)
- How to test the integration end-to-end

---

## Edge cases handled

| Case | Behavior |
|------|----------|
| API key not configured | Skip slot injection, use existing generic link |
| Cal.com API timeout (>5s) | Log warning, fall back to generic link |
| No available slots in window | Skip slot section, fall back to generic link |
| Only 1 slot available | Show the 1 slot + generic link |
| Customer's timezone unknown | Format in business timezone (with abbreviation like "CDT") |
| Cal.com API rate limit hit | 5-min cache mitigates, gracefully falls back on errors |

---

## Rollout

1. Build in a branch — unit tests pass, manual local test against a real Cal.com account
2. Deploy to Railway behind a feature flag (`smart_scheduling_enabled` setting, default false)
3. Flip flag for your own ClearEdge account first, verify delivered emails render correctly
4. Test cases: REPAIR_REQUEST, SALES_INQUIRY, EMERGENCY, cases where Cal.com returns no slots
5. Flip flag for customer accounts

---

## Out of scope (future)

- **Multi-tech routing** — one event type per trade, round-robin across techs (Cal.com handles this via their "Collective" or "Round Robin" event types — set up in Cal.com, no ClearDesk changes)
- **Customer timezone detection** — would require parsing email headers or asking customer; for now, business timezone is the default
- **Non-Cal.com calendar integrations** (Google Calendar, Outlook direct) — Phase 10 material
- **SMS slot confirmations** — out of scope for email flow

---

## Estimated effort

~1 focused session:
- 30 min: settings + env config
- 45 min: `cal-slots.service.ts` + tests
- 30 min: composer + template integration
- 30 min: Settings UI (new section)
- 15 min: docs + roadmap update
- 15 min: manual testing + commit

Total: ~2.5 hours.
