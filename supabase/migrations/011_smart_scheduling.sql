-- ============================================================
-- Migration 011: Smart scheduling settings
-- Injects real Cal.com availability into reply emails as tappable slots.
-- ============================================================

INSERT INTO settings (key, value) VALUES
  ('smart_scheduling_enabled',         'false'),
  ('calcom_api_key',                   '""'),
  ('calcom_event_type_emergency',      '0'),
  ('calcom_event_type_service',        '0'),
  ('calcom_event_type_estimate',       '0'),
  ('business_timezone',                '"America/Chicago"'),
  ('slot_suggestion_days',             '7'),
  ('slot_suggestion_count',            '3')
ON CONFLICT (key) DO NOTHING;
