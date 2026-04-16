-- ============================================================
-- Migration 018: SMS auto-reply
-- Generate an SMS reply via Claude when a customer texts in.
-- Off by default — admin enables in Settings.
-- ============================================================

INSERT INTO settings (key, value) VALUES
  ('sms_auto_reply_enabled',              'false'),
  ('sms_auto_reply_throttle_minutes',     '2')
ON CONFLICT (key) DO NOTHING;
