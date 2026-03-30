-- ============================================================
-- Migration 001: email_cases table
-- Core table for tracking all incoming email cases
-- ============================================================

CREATE TABLE IF NOT EXISTS email_cases (
  id                      BIGSERIAL PRIMARY KEY,
  gmail_message_id        TEXT UNIQUE NOT NULL,
  gmail_thread_id         TEXT,
  from_email              TEXT NOT NULL,
  from_name               TEXT,
  subject                 TEXT,
  body_raw                TEXT,
  body_cleaned            TEXT,
  snippet                 TEXT,
  has_attachments         BOOLEAN DEFAULT FALSE,
  received_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Classification (WF2)
  status                  TEXT NOT NULL DEFAULT 'RECEIVED',
  intent                  TEXT,
  confidence              NUMERIC(4,3),
  classification_reasons  TEXT[],
  emergency_keywords_found TEXT[],
  customer_name           TEXT,
  customer_email          TEXT,
  customer_phone          TEXT,
  service_address         TEXT,
  preferred_times         TEXT,
  problem_summary         TEXT,
  trade                   TEXT,
  urgency_level           TEXT,
  requested_service       TEXT,
  attachments_present     BOOLEAN DEFAULT FALSE,

  -- Routing flags (WF3)
  requires_tech_notify    BOOLEAN DEFAULT FALSE,
  requires_customer_reply BOOLEAN DEFAULT FALSE,

  -- Reply tracking (WF4)
  customer_reply_sent     BOOLEAN DEFAULT FALSE,
  customer_reply_at       TIMESTAMPTZ,

  -- Tech notification tracking (WF5)
  tech_notified           BOOLEAN DEFAULT FALSE,
  tech_notified_at        TIMESTAMPTZ,

  -- Follow-up tracking (WF6)
  followup_count          INTEGER DEFAULT 0,
  last_followup_at        TIMESTAMPTZ,

  -- Metadata
  gmail_labels            TEXT[],
  notes                   TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_email_cases_status ON email_cases(status);
CREATE INDEX IF NOT EXISTS idx_email_cases_intent ON email_cases(intent);
CREATE INDEX IF NOT EXISTS idx_email_cases_received_at ON email_cases(received_at);
CREATE INDEX IF NOT EXISTS idx_email_cases_urgency ON email_cases(urgency_level);
CREATE INDEX IF NOT EXISTS idx_email_cases_customer_reply ON email_cases(customer_reply_sent, status);
CREATE INDEX IF NOT EXISTS idx_email_cases_tech_notify ON email_cases(tech_notified, status, intent);
CREATE INDEX IF NOT EXISTS idx_email_cases_followup ON email_cases(status, followup_count, last_followup_at);

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_email_cases_updated
  BEFORE UPDATE ON email_cases
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
