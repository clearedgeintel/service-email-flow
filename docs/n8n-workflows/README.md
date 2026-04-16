# ClearDesk n8n Workflow Templates

Pre-built [n8n](https://n8n.io) workflows that integrate with ClearDesk's
outbound webhook events and inbound callback API. Import one as a starting
point, wire your credentials, activate.

## What each template does

| File | Trigger | What it does |
| ---- | ------- | ------------ |
| [01-slack-on-case-created.json](01-slack-on-case-created.json) | `case.created` webhook | Posts a rich Slack message to `#service-leads` with case details + dashboard link. |
| [02-sms-tech-on-emergency.json](02-sms-tech-on-emergency.json) | `case.classified` webhook (filtered to `urgency_level=EMERGENCY`) | Sends Twilio SMS to on-call tech, then calls back to ClearDesk to log `TECH_NOTIFIED` on the case timeline. |
| [03-call-summary-email.json](03-call-summary-email.json) | `call.ended` webhook | Fetches the case, sends recap email to the customer, then logs a note back on the case timeline. |

## One-time setup

1. **Generate the ClearDesk callback API key.**
   Dashboard → Settings → n8n Integration → **Reveal** (or **Regenerate** if rotating). Copy the key.

2. **Create an n8n HTTP Header Auth credential** named `ClearDesk API Key` with:
   - Name: `Authorization`
   - Value: `Bearer <paste the key from step 1>`

3. **For each template:** Import via n8n UI (Workflows → Import from File), then:
   - Replace every `cleardesk.yourcompany.com` with your ClearDesk host.
   - Bind the `ClearDesk API Key` credential on every HTTP Request node that calls `/api/n8n/callback` or `/api/cases`.
   - Bind any third-party credentials (Slack, Twilio, SMTP) as noted inline.
   - Activate the workflow and copy its **Production webhook URL** from the Webhook trigger node.

4. **Subscribe ClearDesk to send events to that URL.**
   Dashboard → Settings → Webhooks → Add subscription:
   - URL: the n8n production URL from step 3
   - Events: the ones the template filters on (e.g. `case.created` for template 1, `case.classified` for template 2, `call.ended` for template 3)

5. **Test.** The webhook subscription row has a **Send test event** button.

## Payload shape

Outbound ClearDesk webhooks POST this body:

```json
{
  "event": "case.created",
  "case_id": 123,
  "timestamp": "2026-04-16T12:34:56.789Z",
  "data": { /* event-specific fields */ }
}
```

Delivery is signed with `X-ClearDesk-Signature-256` (HMAC-SHA256 over the raw
body, using the per-subscription secret). n8n's Webhook node does not verify
signatures by default — if you expose n8n publicly, add a Code node that
checks the signature against `$secrets.CLEARDESK_WEBHOOK_SECRET`.

## Callback actions

`POST https://your.cleardesk.host/api/n8n/callback` accepts a discriminated
`action` field. All require a valid `case_id`.

| Action | Body fields | Effect |
| ------ | ----------- | ------ |
| `add_note` | `note`, optional `actor` | Appends to `email_cases.notes` and logs `NOTE_ADDED`. Emits `case.note_added` webhook. |
| `update_status` | `status`, optional `reason` | Changes status (e.g. `NEEDS_REVIEW`) and logs `STATUS_CHANGED`. |
| `close_case` | optional `disposition` | Sets status to `CLOSED`, logs `CLOSED`, emits `case.closed` webhook. |
| `trigger_followup` | *(none)* | Runs the follow-up pipeline immediately for this case. |
| `add_event` | `event_type` (from `EventType` enum, defaults to `NOTE_ADDED`), `summary`, optional `metadata` | Free-form timeline entry. Good for logging external work done by the workflow. |

All responses: `{ "success": true, "action": "<action>", "case_id": <id>, ... }` on 2xx, `{ "error": "..." }` on 4xx/5xx.

## Security

- Rotating the API key (Settings → Regenerate) invalidates every workflow that still carries the old key. Update your n8n credential immediately after rotation.
- The endpoint is rate-limited to 120 req/min per IP.
- Only actions in the list above are accepted — unknown actions return 400.
