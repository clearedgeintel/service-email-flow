# Gmail Inbox Monitoring — Setup Guide

This guide walks you through connecting ServiceFlow to your Gmail account so it can automatically poll for new customer emails every 2 minutes, classify them, and trigger the full automation pipeline.

---

## Overview

**How it works:**

1. The `gmail-intake` BullMQ worker runs every 2 minutes
2. It calls the Gmail API to fetch unread inbox messages (filtering out promotions, social, noreply senders)
3. New emails are deduplicated, stored in the `email_cases` table, and marked as read
4. Each new case is enqueued for AI classification, which triggers routing, reply, and notification

**What you need:**

- A Google Cloud project with the Gmail API enabled
- OAuth2 credentials (Client ID + Client Secret)
- A refresh token for the Gmail account you want to monitor

---

## Step 1: Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click **Select a project** > **New Project**
3. Name it something like `serviceflow-email` and click **Create**
4. Make sure the new project is selected in the top bar

---

## Step 2: Enable the Gmail API

1. Go to **APIs & Services** > **Library**
2. Search for **Gmail API**
3. Click **Gmail API** > **Enable**

---

## Step 3: Configure the OAuth Consent Screen

1. Go to **APIs & Services** > **OAuth consent screen**
2. Select **External** user type (or **Internal** if using Google Workspace)
3. Fill in:
   - **App name:** `ServiceFlow`
   - **User support email:** your email
   - **Developer contact:** your email
4. Click **Save and Continue**
5. On the **Scopes** screen, click **Add or Remove Scopes** and add:
   - `https://www.googleapis.com/auth/gmail.readonly` (read emails)
   - `https://www.googleapis.com/auth/gmail.modify` (mark as read, add labels)
   - `https://www.googleapis.com/auth/gmail.send` (send replies)
6. Click **Save and Continue**
7. On the **Test users** screen, add the Gmail address you want to monitor
8. Click **Save and Continue** > **Back to Dashboard**

> **Note:** While in "Testing" mode, only the test users you add can authorize. This is fine for a single-inbox setup. If you want to remove the "unverified app" warning, submit for Google verification later.

---

## Step 4: Create OAuth2 Credentials

1. Go to **APIs & Services** > **Credentials**
2. Click **+ Create Credentials** > **OAuth client ID**
3. Application type: **Web application**
4. Name: `ServiceFlow Gmail`
5. Under **Authorized redirect URIs**, add:
   ```
   https://developers.google.com/oauthplayground
   ```
6. Click **Create**
7. Copy the **Client ID** and **Client Secret** — you'll need these next

---

## Step 5: Generate a Refresh Token

The refresh token gives ServiceFlow long-lived access to your Gmail without re-authenticating.

1. Go to [OAuth 2.0 Playground](https://developers.google.com/oauthplayground)
2. Click the **gear icon** (top right) and check **Use your own OAuth credentials**
3. Enter your **Client ID** and **Client Secret** from Step 4
4. In the left panel under **Step 1**, find **Gmail API v1** and select these scopes:
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/gmail.modify`
   - `https://www.googleapis.com/auth/gmail.send`
5. Click **Authorize APIs**
6. Sign in with the Gmail account you want to monitor and grant access
7. On **Step 2**, click **Exchange authorization code for tokens**
8. Copy the **Refresh token** value

> **Important:** The refresh token does not expire unless you revoke it or change your password. Store it securely.

---

## Step 6: Add Credentials to .env.local

Open `.env.local` and add these variables:

```env
# --- Gmail API (OAuth2) ---
GMAIL_CLIENT_ID=123456789-abc123.apps.googleusercontent.com
GMAIL_CLIENT_SECRET=GOCSPX-your-secret-here
GMAIL_REFRESH_TOKEN=1//0abc-your-refresh-token-here
GMAIL_SEND_AS=youremail@gmail.com
```

| Variable | Description |
|----------|-------------|
| `GMAIL_CLIENT_ID` | OAuth Client ID from Step 4 |
| `GMAIL_CLIENT_SECRET` | OAuth Client Secret from Step 4 |
| `GMAIL_REFRESH_TOKEN` | Refresh token from Step 5 |
| `GMAIL_SEND_AS` | The email address to send replies from (usually the monitored inbox) |

---

## Step 7: Verify the Connection

Start the app and check that Gmail intake is working:

```bash
# Start Redis (required for BullMQ)
docker compose up redis -d

# Start the worker process
npm run worker
```

Check the logs for:
```
gmail-intake: Polling Gmail for new messages...
gmail-intake: No new messages
```

If you see that, the connection is working. Send a test email to the monitored inbox and wait up to 2 minutes — you should see:

```
gmail-intake: Fetched new messages  count=1
gmail-intake: New case ingested     caseId=1  from=te***@gmail.com
gmail-intake: Enqueued classifier job  caseId=1
```

---

## Step 8: (Optional) Create Gmail Labels

ServiceFlow tries to apply labels to processed emails for easy visual tracking in Gmail. These are optional — the system works without them — but they help you see what's been processed.

In Gmail, create these labels manually (or they'll silently fail, which is fine):

| Label | Applied when |
|-------|-------------|
| `n8n/received` | Email ingested into ServiceFlow |
| `n8n/replied` | Auto-reply sent to customer |
| `n8n/escalated` | Case escalated (emergency or manual) |
| `n8n/closed` | Case closed |

---

## How the Polling Works

The intake pipeline is defined in these files:

| File | Role |
|------|------|
| `src/workers/gmail-intake.worker.ts` | BullMQ worker, runs every 2 minutes |
| `src/services/gmail-intake.service.ts` | Fetches, deduplicates, and stores emails |
| `src/lib/gmail.ts` | Gmail API client (OAuth2 setup) |

**Polling query:**
```
is:unread -category:promotions -category:social -from:noreply -from:no-reply -from:mailer-daemon
```

This fetches up to 10 unread inbox messages per cycle, skipping promotions, social, and automated no-reply senders.

**After processing each email:**
1. Stored in `email_cases` with status `RECEIVED`
2. Marked as read in Gmail (UNREAD label removed)
3. Labeled `n8n/received`
4. Event logged to `case_events`
5. Enqueued for AI classification

---

## Troubleshooting

### "Missing Gmail OAuth2 environment variables"
One or more of `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, or `GMAIL_REFRESH_TOKEN` is not set in `.env.local`.

### "Token has been expired or revoked"
Your refresh token is invalid. This happens if:
- You changed your Google password
- You revoked access in [Google Account Permissions](https://myaccount.google.com/permissions)
- The Google Cloud project was deleted

**Fix:** Repeat Step 5 to generate a new refresh token.

### "Request had insufficient authentication scopes"
The refresh token was created without all required scopes. Repeat Step 5 and make sure all three scopes are selected (readonly, modify, send).

### "Access blocked: This app's request is invalid" (redirect_uri_mismatch)
The redirect URI in the OAuth Playground doesn't match what's configured in your credentials. Make sure `https://developers.google.com/oauthplayground` is listed under **Authorized redirect URIs** in Step 4.

### Emails not being picked up
- Check that the email is in the **Primary** inbox (not Promotions/Social)
- Check that the email is **unread**
- Check that the sender is not a `noreply@` address
- Check Redis is running (`docker compose up redis -d`)
- Check the worker logs for errors

### Duplicate handling
Emails are deduplicated by `gmail_message_id`. If you delete a case from the database, the email will not be re-ingested because it's already been marked as read in Gmail. To re-process an email, mark it as unread in Gmail and delete the corresponding row from `email_cases`.

---

## Security Notes

- The **refresh token** grants full read/write/send access to the Gmail account. Treat it like a password.
- Never commit `.env.local` to git (it's already in `.gitignore`).
- The `GMAIL_SEND_AS` address must match the authenticated account (Gmail won't let you send as a different address without alias configuration).
- Consider using a **dedicated service inbox** (e.g., `service@yourbusiness.com`) rather than a personal Gmail account.
