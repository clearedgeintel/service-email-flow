-- ============================================================
-- Migration 005: Data retention and privacy support
-- Adds archived_at for soft-delete/archival, retention settings,
-- and index for privacy lookups by customer email
-- ============================================================

-- Add archived_at column for soft-delete/archival
ALTER TABLE email_cases ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- Index for finding cases by customer email (GDPR export/forget)
CREATE INDEX IF NOT EXISTS idx_email_cases_customer_email ON email_cases(customer_email);
CREATE INDEX IF NOT EXISTS idx_email_cases_from_email ON email_cases(from_email);

-- Index for archived cases cleanup
CREATE INDEX IF NOT EXISTS idx_email_cases_archived ON email_cases(archived_at) WHERE archived_at IS NOT NULL;

-- Seed retention settings
INSERT INTO settings (key, value) VALUES
  ('retention_days', '365'),
  ('session_cleanup_hours', '48')
ON CONFLICT (key) DO NOTHING;
