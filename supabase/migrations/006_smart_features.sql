-- ============================================================
-- Migration 006: Smart features support
-- Adds sentiment analysis, classification feedback tracking,
-- and repeat customer detection support
-- ============================================================

-- Sentiment columns on email_cases
ALTER TABLE email_cases ADD COLUMN IF NOT EXISTS sentiment_score NUMERIC(3,2);
ALTER TABLE email_cases ADD COLUMN IF NOT EXISTS sentiment_label TEXT;

-- Classification feedback table
CREATE TABLE IF NOT EXISTS classification_feedback (
  id          BIGSERIAL PRIMARY KEY,
  case_id     BIGINT NOT NULL REFERENCES email_cases(id) ON DELETE CASCADE,
  original_intent    TEXT,
  corrected_intent   TEXT,
  original_urgency   TEXT,
  corrected_urgency  TEXT,
  original_trade     TEXT,
  corrected_trade    TEXT,
  original_confidence NUMERIC(4,3),
  actor       TEXT NOT NULL DEFAULT 'admin',
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_classification_feedback_case ON classification_feedback(case_id);
CREATE INDEX IF NOT EXISTS idx_classification_feedback_created ON classification_feedback(created_at);

-- Index for repeat customer lookups (count by email)
CREATE INDEX IF NOT EXISTS idx_email_cases_customer_email_received ON email_cases(customer_email, received_at);
