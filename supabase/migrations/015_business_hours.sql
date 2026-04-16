-- ============================================================
-- Migration 015: Business hours + after-hours call routing
-- Enables per-call routing to a different Retell agent when calls
-- arrive outside configured business hours. Also tags inbound call
-- rows with an after_hours flag for reporting.
-- ============================================================

ALTER TABLE calls
  ADD COLUMN IF NOT EXISTS after_hours BOOLEAN;

CREATE INDEX IF NOT EXISTS idx_calls_after_hours
  ON calls(after_hours)
  WHERE after_hours = true;

-- Business hours stored as JSON so UI can edit without schema churn.
-- Default: weekdays 8am-5pm local (business_timezone from migration 011).
-- weekdays uses ISO: 1=Monday..7=Sunday.
INSERT INTO settings (key, value) VALUES
  ('business_hours_enabled',       'false'),
  ('business_hours_start',         '"08:00"'),
  ('business_hours_end',           '"17:00"'),
  ('business_hours_weekdays',      '[1,2,3,4,5]'),
  ('retell_after_hours_agent_id',  '""')
ON CONFLICT (key) DO NOTHING;
