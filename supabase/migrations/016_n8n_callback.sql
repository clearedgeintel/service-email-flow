-- ============================================================
-- Migration 016: n8n inbound callback API key
-- Bearer token used by n8n workflows calling POST /api/n8n/callback
-- to write back to ClearDesk (add notes, close cases, etc).
-- Generated lazily on first dashboard view if value is still empty.
-- ============================================================

INSERT INTO settings (key, value) VALUES
  ('n8n_callback_api_key', '""')
ON CONFLICT (key) DO NOTHING;
