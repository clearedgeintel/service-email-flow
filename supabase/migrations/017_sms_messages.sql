-- ============================================================
-- Migration 017: Twilio SMS integration
-- Inbound SMS creates cases (like inbound voice). Outbound SMS
-- triggerable from case detail. Messages link to cases by phone.
-- ============================================================

CREATE TABLE IF NOT EXISTS sms_messages (
  id              BIGSERIAL PRIMARY KEY,
  twilio_sid      TEXT UNIQUE NOT NULL,       -- Twilio MessageSid
  case_id         BIGINT REFERENCES email_cases(id) ON DELETE SET NULL,

  direction       TEXT NOT NULL,              -- 'inbound' | 'outbound'
  status          TEXT NOT NULL DEFAULT 'queued', -- queued | sending | sent | delivered | failed | received

  from_number     TEXT NOT NULL,
  to_number       TEXT NOT NULL,
  body            TEXT,
  num_media       INTEGER DEFAULT 0,
  media_urls      JSONB,                      -- array of MMS attachment URLs

  error_code      TEXT,
  error_message   TEXT,

  sent_at         TIMESTAMPTZ,                -- when Twilio accepted the message (outbound)
  delivered_at    TIMESTAMPTZ,                -- delivery receipt from Twilio
  received_at     TIMESTAMPTZ,                -- when we got the inbound webhook

  metadata        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sms_twilio_sid   ON sms_messages(twilio_sid);
CREATE INDEX IF NOT EXISTS idx_sms_case         ON sms_messages(case_id) WHERE case_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sms_from_number  ON sms_messages(from_number);
CREATE INDEX IF NOT EXISTS idx_sms_created_at   ON sms_messages(created_at DESC);

CREATE TRIGGER trg_sms_messages_updated
  BEFORE UPDATE ON sms_messages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Seed Twilio SMS settings. twilio_from_number already exists from earlier.
INSERT INTO settings (key, value) VALUES
  ('twilio_enabled',      'false'),
  ('twilio_account_sid',  '""'),
  ('twilio_auth_token',   '""')
ON CONFLICT (key) DO NOTHING;
