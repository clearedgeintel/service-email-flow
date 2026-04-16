-- ============================================================
-- Migration 014: Retell AI voice agent integration
-- Stores inbound/outbound phone calls handled by Retell AI. Calls
-- link to cases when possible (by phone number or explicit metadata).
-- ============================================================

CREATE TABLE IF NOT EXISTS calls (
  id                BIGSERIAL PRIMARY KEY,
  retell_call_id    TEXT UNIQUE NOT NULL,
  case_id           BIGINT REFERENCES email_cases(id) ON DELETE SET NULL,

  direction         TEXT NOT NULL,           -- 'inbound' | 'outbound'
  status            TEXT NOT NULL DEFAULT 'registered', -- registered | in_progress | ended | error
  agent_id          TEXT,

  from_number       TEXT,
  to_number         TEXT,
  caller_name       TEXT,

  started_at        TIMESTAMPTZ,
  ended_at          TIMESTAMPTZ,
  duration_seconds  INTEGER,

  disconnection_reason TEXT,
  transcript        TEXT,                    -- full plain-text transcript
  transcript_object JSONB,                   -- structured turns for later rendering
  recording_url     TEXT,

  -- Derived analysis (populated by Retell's call_analyzed event)
  summary           TEXT,
  sentiment         TEXT,                    -- Positive | Neutral | Negative | Unknown
  call_successful   BOOLEAN,
  in_voicemail      BOOLEAN,
  custom_data       JSONB,                   -- extracted fields (caller_name, problem, urgency, etc.)

  metadata          JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calls_retell_id ON calls(retell_call_id);
CREATE INDEX IF NOT EXISTS idx_calls_case ON calls(case_id) WHERE case_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_calls_from_number ON calls(from_number);
CREATE INDEX IF NOT EXISTS idx_calls_started_at ON calls(started_at DESC);

CREATE TRIGGER trg_calls_updated
  BEFORE UPDATE ON calls
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Seed Retell settings
INSERT INTO settings (key, value) VALUES
  ('retell_enabled',             'false'),
  ('retell_api_key',             '""'),
  ('retell_inbound_agent_id',    '""'),
  ('retell_outbound_agent_id',   '""')
ON CONFLICT (key) DO NOTHING;
