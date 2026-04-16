-- ============================================================
-- Migration 013: Customer portal
-- Public, tokenized status view so customers can check their case
-- without logging in. Each case gets a short URL-safe token embedded
-- in its reply email. No PII is exposed beyond what the customer
-- already knows.
-- ============================================================

CREATE TABLE IF NOT EXISTS case_access_tokens (
  token        TEXT PRIMARY KEY,
  case_id      BIGINT NOT NULL REFERENCES email_cases(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ,                           -- nullable = never expires
  last_viewed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_case_access_tokens_case ON case_access_tokens(case_id);
CREATE INDEX IF NOT EXISTS idx_case_access_tokens_expires ON case_access_tokens(expires_at);

-- New settings for customer portal
INSERT INTO settings (key, value) VALUES
  ('portal_enabled',             'true'),
  ('portal_token_ttl_days',      '180'),          -- 6 month default, null = forever
  ('portal_base_url',            '""')            -- e.g. "https://app.cleardesk.com" — populated from request if empty
ON CONFLICT (key) DO NOTHING;
