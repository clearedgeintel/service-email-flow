-- ============================================================
-- Migration 003: case_events table
-- Audit log / timeline for each case
-- ============================================================

CREATE TABLE IF NOT EXISTS case_events (
  id          BIGSERIAL PRIMARY KEY,
  case_id     BIGINT NOT NULL REFERENCES email_cases(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL,
  actor       TEXT NOT NULL DEFAULT 'system',
  summary     TEXT,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_case_events_case_id ON case_events(case_id);
CREATE INDEX IF NOT EXISTS idx_case_events_type ON case_events(event_type);
CREATE INDEX IF NOT EXISTS idx_case_events_created_at ON case_events(created_at);
