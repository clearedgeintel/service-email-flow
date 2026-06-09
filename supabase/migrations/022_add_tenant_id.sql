-- ============================================================
-- Migration 022: tenant_id columns on all data tables (Phase 1 PR2)
-- Expand-then-contract pattern: tenant_id is added NULLABLE here so
-- this migration is reversible and doesn't break inflight INSERTs from
-- code that hasn't been deployed yet. PR2's app-code update sets
-- tenant_id on every new row. A follow-up migration (023) locks
-- NOT NULL once we've confirmed writes are clean, plus adds RLS.
-- ============================================================

-- Resolve the default tenant once for the backfill below.
DO $$
DECLARE
  default_tenant_id UUID;
BEGIN
  SELECT id INTO default_tenant_id FROM tenants WHERE slug = 'default';

  IF default_tenant_id IS NULL THEN
    RAISE EXCEPTION
      'Default tenant (slug="default") not found. Run migration 021_multi_tenant_foundation first.';
  END IF;

  -- email_cases — core table, hot path
  ALTER TABLE email_cases ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
  UPDATE email_cases SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  CREATE INDEX IF NOT EXISTS idx_email_cases_tenant ON email_cases(tenant_id);

  -- case_events
  ALTER TABLE case_events ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
  UPDATE case_events SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  CREATE INDEX IF NOT EXISTS idx_case_events_tenant ON case_events(tenant_id);

  -- classification_feedback (created by migration 006)
  ALTER TABLE classification_feedback ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
  UPDATE classification_feedback SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  CREATE INDEX IF NOT EXISTS idx_classification_feedback_tenant ON classification_feedback(tenant_id);

  -- case_access_tokens (customer portal — migration 013)
  ALTER TABLE case_access_tokens ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
  UPDATE case_access_tokens SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  CREATE INDEX IF NOT EXISTS idx_case_access_tokens_tenant ON case_access_tokens(tenant_id);

  -- calls (Retell — migration 014)
  ALTER TABLE calls ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
  UPDATE calls SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  CREATE INDEX IF NOT EXISTS idx_calls_tenant ON calls(tenant_id);

  -- sms_messages (Twilio — migration 017)
  ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
  UPDATE sms_messages SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  CREATE INDEX IF NOT EXISTS idx_sms_messages_tenant ON sms_messages(tenant_id);

  -- poll_history (gmail-intake observability — migration 009)
  ALTER TABLE poll_history ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
  UPDATE poll_history SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  CREATE INDEX IF NOT EXISTS idx_poll_history_tenant ON poll_history(tenant_id);

  -- webhook_subscriptions (outbound webhook config — migration 012)
  ALTER TABLE webhook_subscriptions ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
  UPDATE webhook_subscriptions SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_tenant ON webhook_subscriptions(tenant_id);

  -- webhook_deliveries
  ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
  UPDATE webhook_deliveries SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_tenant ON webhook_deliveries(tenant_id);

  -- pricing_items (migration 002)
  ALTER TABLE pricing_items ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
  UPDATE pricing_items SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  CREATE INDEX IF NOT EXISTS idx_pricing_items_tenant ON pricing_items(tenant_id);

  -- email_templates (migration 010) — PK stays as `key` for now; in PR2B
  -- this becomes composite (tenant_id, key) when we lock down read-paths.
  ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
  UPDATE email_templates SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  CREATE INDEX IF NOT EXISTS idx_email_templates_tenant ON email_templates(tenant_id);

  -- settings — global PK on `key` today; same story as email_templates:
  -- add column nullable, backfill, defer composite PK to PR2B.
  ALTER TABLE settings ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
  UPDATE settings SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  CREATE INDEX IF NOT EXISTS idx_settings_tenant ON settings(tenant_id);
END $$;

-- ------------------------------------------------------------
-- Verification queries (admin can run manually after migration):
--
--   SELECT 'email_cases' AS table_name, COUNT(*) AS missing FROM email_cases WHERE tenant_id IS NULL
--   UNION ALL SELECT 'case_events',           COUNT(*) FROM case_events           WHERE tenant_id IS NULL
--   UNION ALL SELECT 'classification_feedback', COUNT(*) FROM classification_feedback WHERE tenant_id IS NULL
--   UNION ALL SELECT 'case_access_tokens',    COUNT(*) FROM case_access_tokens    WHERE tenant_id IS NULL
--   UNION ALL SELECT 'calls',                 COUNT(*) FROM calls                 WHERE tenant_id IS NULL
--   UNION ALL SELECT 'sms_messages',          COUNT(*) FROM sms_messages          WHERE tenant_id IS NULL
--   UNION ALL SELECT 'poll_history',       COUNT(*) FROM poll_history       WHERE tenant_id IS NULL
--   UNION ALL SELECT 'webhook_subscriptions', COUNT(*) FROM webhook_subscriptions WHERE tenant_id IS NULL
--   UNION ALL SELECT 'webhook_deliveries',    COUNT(*) FROM webhook_deliveries    WHERE tenant_id IS NULL
--   UNION ALL SELECT 'pricing_items',         COUNT(*) FROM pricing_items         WHERE tenant_id IS NULL
--   UNION ALL SELECT 'email_templates',       COUNT(*) FROM email_templates       WHERE tenant_id IS NULL
--   UNION ALL SELECT 'settings',              COUNT(*) FROM settings              WHERE tenant_id IS NULL;
--
-- Every row in the `missing` column should be 0 immediately after this
-- migration runs. New rows written by PR2 code should always carry a
-- tenant_id — PR2B will lock NOT NULL once that's confirmed.
-- ------------------------------------------------------------
