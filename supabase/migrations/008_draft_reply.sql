-- Store generated reply drafts for in-dashboard review/approval
ALTER TABLE email_cases ADD COLUMN IF NOT EXISTS draft_reply JSONB;
ALTER TABLE email_cases ADD COLUMN IF NOT EXISTS draft_gmail_id TEXT;
