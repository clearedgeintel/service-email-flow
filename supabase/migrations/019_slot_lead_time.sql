-- ============================================================
-- Migration 019: Configurable slot lead time
-- Controls how close to "now" an open Cal.com slot can be before
-- ClearDesk offers it in a reply. Default 30 min (enough runway
-- for a tech to prep + travel); set to 0 for testing/demo so the
-- next-available slot always qualifies.
-- ============================================================

INSERT INTO settings (key, value) VALUES
  ('slot_suggestion_min_lead_minutes', '30')
ON CONFLICT (key) DO NOTHING;
