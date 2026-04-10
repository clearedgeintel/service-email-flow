-- ============================================================
-- Migration 007: Cal.com booking integration
-- Track when customers actually book appointments via Cal.com webhooks
-- ============================================================

ALTER TABLE email_cases ADD COLUMN IF NOT EXISTS booking_id TEXT;
ALTER TABLE email_cases ADD COLUMN IF NOT EXISTS booking_status TEXT;
ALTER TABLE email_cases ADD COLUMN IF NOT EXISTS booking_start_at TIMESTAMPTZ;
ALTER TABLE email_cases ADD COLUMN IF NOT EXISTS booking_end_at TIMESTAMPTZ;
ALTER TABLE email_cases ADD COLUMN IF NOT EXISTS booking_url TEXT;
ALTER TABLE email_cases ADD COLUMN IF NOT EXISTS booking_cancelled_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_email_cases_booking_id ON email_cases(booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_email_cases_booking_start ON email_cases(booking_start_at) WHERE booking_start_at IS NOT NULL;
