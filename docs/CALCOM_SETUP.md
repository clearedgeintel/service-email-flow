# Cal.com Booking Integration Setup

ServiceFlow can receive booking events from Cal.com via webhooks. This lets you see when customers actually book an appointment after receiving a reply, and automatically close cases when the meeting is completed.

---

## How it works

1. ServiceFlow sends a reply to the customer with a Cal.com booking link (configured in Settings)
2. Customer clicks the link and books a time on your Cal.com page
3. Cal.com sends a webhook to `/api/webhooks/calcom` on your ServiceFlow instance
4. ServiceFlow matches the booking to the most recent open case for that customer's email
5. The case is updated with the booking time and status

**Event mapping:**

| Cal.com Event | ServiceFlow Action |
|--------------|-------------------|
| `BOOKING_CREATED` | Booking timestamp + `booked` status |
| `BOOKING_RESCHEDULED` | Update booking timestamp |
| `BOOKING_CANCELLED` | Mark `cancelled`, move case to `NEEDS_REVIEW` |
| `MEETING_ENDED` | Mark `completed`, close the case |

---

## Setup Steps

### 1. Generate a webhook secret

Pick a random 32+ character string. On Linux/Mac:

```bash
openssl rand -hex 32
```

Add it to `.env.local`:

```env
CALCOM_WEBHOOK_SECRET=<your-secret>
```

### 2. Expose your local instance (dev only)

Cal.com needs to reach your webhook endpoint. For local development, use a tunnel:

- **ngrok**: `ngrok http 3000` → copy the HTTPS URL
- **Cloudflare Tunnel**: `cloudflared tunnel --url http://localhost:3000`

Your webhook URL will be: `https://your-tunnel.ngrok.io/api/webhooks/calcom`

For production, use your actual domain: `https://yourdomain.com/api/webhooks/calcom`

### 3. Configure the webhook in Cal.com

1. Go to **Cal.com → Settings → Developer → Webhooks**
2. Click **New Webhook**
3. Fill in:
   - **Subscriber URL**: your webhook URL from step 2
   - **Event Triggers**: enable these:
     - ✅ Booking Created
     - ✅ Booking Rescheduled
     - ✅ Booking Cancelled
     - ✅ Meeting Ended *(optional — auto-closes case when meeting ends)*
   - **Secret**: paste the same value as `CALCOM_WEBHOOK_SECRET` in your `.env.local`
4. Click **Save**

### 4. Test the webhook

In Cal.com's webhook settings, click **Send Test**. You should see a `200 OK` response.

If you get a `401`, the secret is mismatched.  
If you get a `400`, the payload format is unexpected.  
Check the server logs for details.

### 5. Set booking URLs in ServiceFlow

In the ServiceFlow dashboard → **Settings** → update the Cal.com booking URLs to point to your actual Cal.com event types:

- **Emergency Booking URL** (e.g., `https://cal.com/yourname/emergency`)
- **Service Call Booking URL** (e.g., `https://cal.com/yourname/service-call`)
- **Free Estimate Booking URL** (e.g., `https://cal.com/yourname/estimate`)

These are the links sent to customers in reply emails.

---

## Case Matching Logic

When a booking webhook arrives, ServiceFlow matches it to a case in this order:

1. **By `booking_id`** — if this booking was already seen (e.g., a reschedule), match the existing case
2. **By customer email** — find the most recent non-closed case where `customer_email` or `from_email` matches the Cal.com attendee email

If no match is found, the webhook returns `{ handled: false, reason: 'No matching case found' }` and logs a warning. This can happen if:

- Customer booked with a different email than they originally used
- The case was already closed before they booked
- The booking is from someone never in your system

---

## Security

- **HMAC-SHA256 signature verification** — Cal.com signs each webhook payload. ServiceFlow verifies with `CALCOM_WEBHOOK_SECRET`.
- **Rate limiting** — 60 requests per minute per IP on the webhook endpoint.
- **No auth required** — the endpoint is public but signature-protected. Without the secret, attackers can't forge bookings.

If `CALCOM_WEBHOOK_SECRET` is **not set**, signature verification is skipped. This is useful for local testing but **never use this in production**.

---

## Troubleshooting

### Webhook returns 401 "Invalid signature"
- Secret in Cal.com doesn't match `CALCOM_WEBHOOK_SECRET` in `.env.local`
- Restart the Next.js server after changing `.env.local`

### Webhook returns 200 but says "No matching case found"
- Customer used a different email for booking than for their original email
- Fix: add an alias in Supabase or manually link the booking

### Case shows the booking but status doesn't change
- Check the case's event timeline — look for the `STATUS_CHANGED` event from actor `calcom`
- Verify the worker process is running: bookings update the DB directly, not via queue

### Webhook never arrives
- Verify your ngrok/tunnel URL is still active
- Check Cal.com webhook logs: **Settings → Developer → Webhooks → History**
