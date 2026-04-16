-- ============================================================
-- Migration 012: Outbound webhook subscriptions and delivery log
-- Generic event emitter so customers can wire up Zapier, n8n, CRMs, etc.
-- without custom integrations inside ClearDesk.
-- ============================================================

CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id             BIGSERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  url            TEXT NOT NULL,
  secret         TEXT NOT NULL,                        -- HMAC-SHA256 signing key
  events         TEXT[] NOT NULL DEFAULT '{}',          -- subscribed event types
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  description    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_subs_active ON webhook_subscriptions(active) WHERE active = TRUE;

CREATE TRIGGER trg_webhook_subs_updated
  BEFORE UPDATE ON webhook_subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id                BIGSERIAL PRIMARY KEY,
  subscription_id   BIGINT NOT NULL REFERENCES webhook_subscriptions(id) ON DELETE CASCADE,
  event_type        TEXT NOT NULL,
  case_id           BIGINT,                              -- nullable; not every event has a case
  payload           JSONB NOT NULL,
  attempt           INTEGER NOT NULL DEFAULT 1,
  status            TEXT NOT NULL DEFAULT 'pending',     -- pending | success | failed
  response_status   INTEGER,
  response_body     TEXT,
  error             TEXT,
  sent_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_sub ON webhook_deliveries(subscription_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status ON webhook_deliveries(status, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_event ON webhook_deliveries(event_type, sent_at DESC);
