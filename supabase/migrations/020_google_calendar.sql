-- ============================================================
-- Migration 020: Google Calendar read-only provider settings
-- Overlays the admin's Google Calendar as "busy blocks" on the
-- calendar view. Reuses GMAIL_CLIENT_ID/SECRET env vars + a new
-- GOOGLE_CALENDAR_REFRESH_TOKEN minted with calendar.readonly scope.
-- See docs/GOOGLE_CALENDAR_SETUP.md.
-- ============================================================

INSERT INTO settings (key, value) VALUES
  ('google_calendar_enabled',     'false'),
  ('google_calendar_id',          '"primary"'),
  ('google_calendar_show_titles', 'true')
ON CONFLICT (key) DO NOTHING;
