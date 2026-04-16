# Retell AI Voice Agent Setup

> Enables inbound phone calls to flow through ClearDesk. A Retell-powered voice agent answers, collects customer info (name, problem, urgency, address), and creates a case automatically. The email pipeline handles the rest (classify → route → reply).

This covers **inbound calls only** for now. Outbound callbacks and in-dashboard transcript viewing are planned for later sessions.

---

## What ships today

- DB migration 014: `calls` table storing Retell call data + Retell settings
- `/api/webhooks/retell` endpoint: signature-verified, rate-limited
- Case auto-creation from inbound calls at `call_analyzed` time
- Phone-number matching to link follow-up calls to existing open cases
- Settings → Retell AI Voice Agent toggle + config fields
- `call.started`, `call.ended`, `call.analyzed` events emitted via the webhook system so Zapier/n8n can react

---

## Phase 1: Retell account and agent

### 1.1 Create a Retell account

1. Go to [retellai.com](https://www.retellai.com/) and sign up
2. Add a payment method (Retell charges per call minute)

### 1.2 Create an inbound agent

1. Retell dashboard → **Agents** → **Create Agent**
2. Name: `ClearDesk Inbound`
3. Voice: pick whatever sounds appropriate for your business
4. **LLM prompt** (example for a plumbing/electric service):
   ```
   You are the receptionist for {{business_name}}.
   Greet the caller warmly, then gather:
   - Their full name
   - A description of the problem they need help with
   - The service address (street + city)
   - Urgency (emergency/today/this week/routine)

   If they mention gas smell, active flooding, or sparking outlets,
   mark urgency as EMERGENCY and reassure them someone will call back
   within 15 minutes.

   Keep it under 2 minutes. Confirm their phone number before hanging up
   so we can call back. Thank them and end the call.
   ```

### 1.3 Configure custom analysis fields

This is the critical step — it's how Retell extracts structured data from the conversation so ClearDesk can create a case.

In the agent config → **Post-Call Analysis** → **Custom Extracted Fields**, add:

| Field name | Type | Description |
|------------|------|-------------|
| `caller_name` | string | Full name of the caller |
| `problem` | string | 1-2 sentence description of the issue |
| `trade` | enum (electric / plumbing / both / unknown) | What service they need |
| `urgency` | enum (EMERGENCY / TODAY / THIS_WEEK / ROUTINE) | How urgent |
| `service_address` | string | Their street address |

**ClearDesk reads these fields automatically** to populate the case. Field names must match exactly (case-sensitive).

### 1.4 Get your API key and agent ID

1. Retell dashboard → **API Keys** → copy key (starts with `key_...`)
2. Open the agent → copy the agent ID (starts with `agent_...`)

### 1.5 Set up a phone number

1. Retell dashboard → **Phone Numbers** → **Buy a Number** (or import from Twilio)
2. Assign the **ClearDesk Inbound** agent as the inbound handler
3. Forward your existing business phone number to this Retell number (or publish the Retell number directly)

---

## Phase 2: Configure ClearDesk

### 2.1 Apply migration 014

Supabase SQL Editor → paste [supabase/migrations/014_retell_calls.sql](../supabase/migrations/014_retell_calls.sql) → Run.

### 2.2 Fill in settings

Dashboard → **Settings → Configuration** tab → scroll to **Retell AI Voice Agent** section:

- **Retell API Key** — from step 1.4
- **Inbound Agent ID** — from step 1.4 (the one you just created)
- **Outbound Agent ID** — leave blank for now (used in future sessions)

Save.

### 2.3 Flip the toggle

Scroll up to **Reply Mode** card → find the **Retell AI voice agent** toggle → turn it ON. Save.

Until the toggle is ON, ClearDesk silently ignores incoming Retell webhooks (returns 200 without processing) so Retell doesn't retry.

### 2.4 Configure the webhook in Retell

Back in Retell dashboard → **Settings → Webhooks**:

- **URL:** `https://your-cleardesk-domain.com/api/webhooks/retell`
- **Events:** check all three:
  - `call_started`
  - `call_ended`
  - `call_analyzed`

Retell uses your API key as the signing secret automatically (via their SDK's `Retell.verify` helper). No extra secret to copy.

---

## Phase 3: Test it

1. Call the Retell phone number from your cell
2. Go through the agent's prompts — pretend you're a customer with a broken water heater
3. Hang up
4. Within ~30 seconds, ClearDesk should:
   - Log a `call_started` → `call_ended` → `call_analyzed` sequence in the worker logs
   - Create a new case in the dashboard with the extracted info
   - The case appears with the right intent, urgency, trade based on the agent's extraction

Check:
- Dashboard → Cases — new case should appear with your phone number
- Supabase → `calls` table — row with transcript, summary, sentiment, custom_data
- Supabase → `case_events` — `RECEIVED` event with `source: retell`

---

## How case linking works

When a call comes in, ClearDesk tries to find an existing case:

1. **By phone number match** — strips non-digits, matches last 10 digits against `email_cases.customer_phone` on all non-closed cases. If found, links the call to that case.
2. **No match + `call_analyzed` event** — creates a new case from the analyzed data (caller name, problem, trade, urgency, address).

This means:
- A customer who emailed first, then called for status → call links to their email case
- A customer who called first → gets a new case created from the call data
- Multiple calls from the same person → all link to their most recent open case

---

## Outbound webhooks

Whenever a call event happens, ClearDesk emits its own outbound webhook:

| Retell event | ClearDesk webhook |
|--------------|-------------------|
| `call_ended` | `call.ended` |

Subscribe via **Settings → Webhooks tab** to react in Zapier, n8n, Slack, etc.

---

## Security

- Retell webhook requests are signature-verified via `Retell.verify(rawBody, apiKey, x-retell-signature)` — invalid signatures return 401
- Endpoint is rate-limited to 120 requests/minute per IP (high enough for bursty call traffic)
- Disabled Retell integration silently no-ops webhooks with a 200 so Retell doesn't retry

---

## Troubleshooting

### Webhook returns 401 "Invalid signature"
- Your Retell API key in ClearDesk Settings doesn't match the key used by Retell to sign webhooks. Paste the current key and save.
- Restart Railway services after changing the key (settings cache may hold the old value for up to 60 seconds).

### Webhook returns 200 with `skipped: retell_disabled`
- You haven't flipped the **Retell AI voice agent** toggle in Settings. Turn it on.

### No case created after the call
- Check `call_analyzed` arrived (look in `calls` table — `summary` should be populated)
- Check the custom analysis fields are configured in Retell with exact names: `caller_name`, `problem`, `trade`, `urgency`, `service_address`
- If Retell's analysis misses a required field, the case is created with defaults (`intent: REPAIR_REQUEST`, `urgency: ROUTINE`)

### Call links to wrong case
- Phone matching uses last 10 digits. If the caller's number matches an old open case they forgot about, it links there.
- Fix: close stale cases so they're excluded from matching.

---

## What's coming in follow-up sessions

- Outbound call triggering from the case detail page ("Call this customer")
- Call transcript + recording panel on the case detail page
- Voice agent uses live ClearDesk business config via `retell_llm_dynamic_variables` (pricing, booking URLs)
- Voice analytics in the dashboard (call volume, sentiment trends, resolution rates)
