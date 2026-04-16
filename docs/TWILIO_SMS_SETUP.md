# Twilio SMS Setup

ClearDesk's SMS channel uses Twilio for inbound (customer texts in → case
created or linked) and outbound (admin sends SMS from the case detail
page). Phone numbers are tail-matched against open cases using the same
logic as the Retell voice channel.

## Prerequisites

- A Twilio account with a provisioned phone number that supports SMS.
- ClearDesk deployed with a publicly reachable base URL (Twilio must be
  able to POST webhooks to it). Note that URL below — we'll use it in a
  couple of places.

## 1. Grab the Twilio credentials

Twilio Console → **Account → API keys & tokens**:

- **Account SID** — starts with `AC...`
- **Auth Token** — click to reveal, copy it

## 2. Enter them in ClearDesk

Dashboard → **Settings**:

1. Scroll to the **Twilio SMS** section.
2. Paste Account SID, Auth Token, and the Twilio phone number in
   E.164 format (e.g. `+15551234567`) into the **From Number** field.
3. Click **Save settings**.
4. Flip the **Twilio SMS** toggle on (in the toggles card above).

The auth token is stored server-side and used to verify inbound webhook
signatures. If it's wrong, Twilio webhooks will return 401 and the
endpoint won't process messages.

## 3. Point Twilio at the webhook endpoints

Twilio Console → **Phone Numbers → Manage → Active numbers → select your
number**:

**Messaging configuration:**

| Field | Value |
| ----- | ----- |
| A message comes in | Webhook · `POST` · `https://<your-cleardesk-host>/api/webhooks/twilio/sms` |
| Primary handler fails | _(leave blank or set a fallback)_ |

Click **Save configuration**.

**Optional — delivery receipts** (lets ClearDesk track whether outbound
messages were delivered or failed):

When creating messages the server uses the default Messaging Service
callback. For status callbacks per-message, Twilio's free path is to
configure a Messaging Service with its **Status callback URL** set to
`https://<your-cleardesk-host>/api/webhooks/twilio/status`.

## 4. Test it

From any phone, text your Twilio number. Within a few seconds you
should see:

- A new case (or an updated existing case if the sender's phone number
  matches a case on file) in the dashboard.
- The SMS body rendered in the case's **SMS** panel.
- A `RECEIVED` event on the case timeline.
- An outbound webhook event `sms.received` fires if any subscription
  listens for it.

To test outbound: open a case with a `customer_phone`, type a reply in
the SMS panel, click Send. You'll see a new outbound row immediately
with `queued` status, transitioning to `sent` then `delivered` as
Twilio status callbacks come in (if configured).

## Event payloads

Outbound ClearDesk webhooks fired by the SMS channel:

### `sms.received`

```json
{
  "event": "sms.received",
  "case_id": 123,
  "timestamp": "2026-04-16T12:34:56.789Z",
  "data": {
    "twilio_sid": "SMxxxx",
    "from": "+15551112222",
    "to": "+15553334444",
    "body": "AC not working",
    "media_urls": []
  }
}
```

### `sms.sent`

```json
{
  "event": "sms.sent",
  "case_id": 123,
  "timestamp": "2026-04-16T12:36:00.000Z",
  "data": {
    "twilio_sid": "SMout1",
    "to": "+15551112222",
    "body": "Your tech is on the way."
  }
}
```

## Troubleshooting

| Symptom | Likely cause | Fix |
| ------- | ------------ | --- |
| Twilio webhook returns 401 | Auth token in ClearDesk doesn't match the token Twilio is signing with | Re-copy the token from Twilio Console; some UIs strip whitespace, paste into a terminal first to verify. |
| Inbound SMS silently skipped | `twilio_enabled` toggle is off | Turn on the Twilio SMS toggle in Settings. |
| Outbound SMS 400 "No outbound number configured" | `twilio_from_number` empty | Set From Number in Settings. |
| Messages go to the wrong case | Existing open case with same phone number in a different format | Close the stale case or edit its `customer_phone`. Tail-match is last-10-digits based. |
| Inbound MMS attachments show as links but don't load | Twilio media URLs require the Account SID as basic auth | Click-through in the dashboard opens them in a new tab — you may need to be logged into Twilio. |

## Related

- [RETELL_SETUP.md](RETELL_SETUP.md) — voice channel, uses identical
  phone-matching logic.
- [n8n-workflows/README.md](n8n-workflows/README.md) — build workflows
  that react to `sms.received` / `sms.sent` events.
