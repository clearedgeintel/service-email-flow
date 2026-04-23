# Google Calendar Integration Setup

ClearDesk can overlay your Google Calendar as **read-only busy blocks** on the
`/dashboard/calendar` view — so you see your personal schedule next to
ClearDesk bookings and Cal.com slots and spot conflicts at a glance.

No two-way sync, no booking creation. Events flow in only.

---

## 1. Reuse the Gmail Google Cloud project

Google Calendar and Gmail live in the same Cloud project. Everything you set
up in [GMAIL_SETUP.md](GMAIL_SETUP.md) — OAuth consent screen, Client ID,
Client Secret — is reused here.

You do **not** need a new Client ID/Secret. You **do** need a new OAuth
refresh token minted with the calendar scope.

---

## 2. Enable the Google Calendar API

1. Go to [Google Cloud Console → APIs & Services → Library](https://console.cloud.google.com/apis/library)
2. Search for **Google Calendar API**
3. Click **Enable** on the project your Gmail integration already uses

---

## 3. Add the calendar scope to the OAuth consent screen

1. Still in Google Cloud Console → **APIs & Services → OAuth consent screen → Scopes**
2. Click **Add or remove scopes**
3. Add `https://www.googleapis.com/auth/calendar.readonly`
4. Save

(If the consent screen is in **Testing** mode, add yourself as a **Test user**
under the Audience section if you're not already listed.)

---

## 4. Mint a refresh token via OAuth Playground

This is a separate refresh token from the Gmail one — same Client ID/Secret,
but signed for the calendar scope only.

1. Go to [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/)
2. Click the **gear** (top right) → check **Use your own OAuth credentials**
   - Paste your `GMAIL_CLIENT_ID` as the OAuth Client ID
   - Paste your `GMAIL_CLIENT_SECRET` as the OAuth Client secret
3. In the **Step 1 — Select & authorize APIs** panel, paste into the custom
   scopes field (at the bottom):
   ```
   https://www.googleapis.com/auth/calendar.readonly
   ```
   Click **Authorize APIs**. Sign in with the Google account whose calendar
   you want ClearDesk to read.
4. **Step 2 — Exchange authorization code for tokens**: click the button.
5. Copy the **Refresh token** — the long string starting with `1//`.

---

## 5. Set the env var

Add to your Railway **web** and **worker** services' **Variables**:

```
GOOGLE_CALENDAR_REFRESH_TOKEN=1//0g...
```

For local dev, add the same line to `.env.local` and restart `npm run dev`
plus `npm run workers`.

The existing `GMAIL_CLIENT_ID` and `GMAIL_CLIENT_SECRET` are reused
automatically — no duplicate env vars needed.

---

## 6. Turn it on in ClearDesk

Dashboard → **Settings** → scroll to the toggle cluster (after Retell /
Twilio / Business Hours).

- **Google Calendar overlay** — flip on. The toggle description updates to
  confirm events will be fetched.
- **Show real Google event titles** — on by default. When on, real summaries
  like "Dentist appointment" display. Flip off to render every event as
  "Busy" if the calendar contains personal details you don't want on-screen.
- **Calendar ID** (SETTING_GROUPS field, default `primary`) — leave as
  `primary` to read the authenticated user's default calendar. Paste a
  specific ID (e.g. `team@group.calendar.google.com`) to read a different
  calendar you have access to.

Click **Save settings**.

---

## 7. Verify

Open `/dashboard/calendar`. Your Google events render as yellow blocks
alongside the blue ClearDesk bookings and violet Cal.com events.

Click any Google event — it opens in Google Calendar via its `htmlLink`.

---

## What gets filtered out

Events that do **not** appear on the overlay:

| Why filtered | Google field |
|---|---|
| Event is cancelled | `status === 'cancelled'` |
| Event is marked "Available" (free time) | `transparency === 'transparent'` |
| You declined the invite | your attendee entry has `responseStatus === 'declined'` |

Events the admin organized (no self-attendee) are always kept.

Recurring events are expanded into concrete instances within the viewed
window — no RRULE surprises.

---

## Troubleshooting

### "invalid_grant" in worker logs

The refresh token was revoked or the scope was removed. Mint a new token
(step 4) with the calendar scope, update Railway env vars, restart services.

### "Not Found" / calendar ID errors

The `google_calendar_id` setting points at a calendar you don't have access
to with the current token. Check at
[calendar.google.com/calendar/u/0/r/settings](https://calendar.google.com/calendar/u/0/r/settings)
— your calendars' IDs are listed under **Settings for my calendars**. For
the primary, leave the setting as `primary`.

### Events don't appear even though they exist

1. Check the toggle is **on**
2. Confirm `GOOGLE_CALENDAR_REFRESH_TOKEN` is in Railway **both** web and
   worker (though only web reads it today, worker will for future sync
   features)
3. Check the filters — is the event cancelled, marked Available, or declined?
4. Look at worker logs for a `Google Calendar events.list failed` warning —
   that means the API call threw

### Rate limits

Google Calendar's daily quota is 1,000,000 queries per day. ClearDesk
fetches live per page render; at 50 calendar-page loads per minute you're
using ~72,000/day. Well under. No caching layer in v1.

---

## Security notes

- The refresh token grants read access to your calendar. Treat it like a
  password. Rotate if you share screens or push env vars accidentally.
- Scope is `calendar.readonly` — Google will reject any write attempt even
  if code tried.
- Revoke at any time via
  [myaccount.google.com/permissions](https://myaccount.google.com/permissions).
  The overlay will stop populating; other calendar providers (ClearDesk
  bookings, Cal.com) keep working.

---

## Related

- [GMAIL_SETUP.md](GMAIL_SETUP.md) — the Gmail integration that shares this
  Google Cloud project
- [CALCOM_SETUP.md](CALCOM_SETUP.md) — the slot-booking integration that
  shares the calendar view
