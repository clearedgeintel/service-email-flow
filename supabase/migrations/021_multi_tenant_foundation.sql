-- ============================================================
-- Migration 021: Multi-tenant foundation (Phase 1 PR1)
-- Introduces the tenants/users/sessions/tenant_credentials tables
-- side-by-side with the existing single-tenant data. NOTHING about
-- the running system changes — existing tables are untouched, and
-- the existing admin_sessions/ADMIN_PASSWORD flow keeps working
-- until PR3 cuts over.
-- PR2 backfills tenant_id columns on all data tables.
-- ============================================================

-- Required for UUID generation (pgcrypto provides gen_random_uuid)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ------------------------------------------------------------
-- tenants — one row per business on the platform
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT UNIQUE NOT NULL,                -- subdomain key, e.g. "profix"
  name        TEXT NOT NULL,                       -- display: "ProFix Electric"
  status      TEXT NOT NULL DEFAULT 'active',      -- active | suspended | trialing
  plan        TEXT NOT NULL DEFAULT 'starter',     -- starter | pro | enterprise
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);
CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);

DROP TRIGGER IF EXISTS trg_tenants_updated ON tenants;
CREATE TRIGGER trg_tenants_updated
  BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ------------------------------------------------------------
-- users — replaces single ADMIN_PASSWORD; users belong to a tenant
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email          TEXT NOT NULL,
  password_hash  TEXT NOT NULL,                    -- bcrypt
  name           TEXT,
  role           TEXT NOT NULL DEFAULT 'admin',    -- admin | super_admin (platform-level)
  last_login_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, email)
);

CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_email_lookup ON users(LOWER(email));  -- cross-tenant login

DROP TRIGGER IF EXISTS trg_users_updated ON users;
CREATE TRIGGER trg_users_updated
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ------------------------------------------------------------
-- sessions — replaces admin_sessions; carries tenant + user context.
-- The old admin_sessions table stays in place until PR3 cuts over.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_tenant ON sessions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- ------------------------------------------------------------
-- tenant_credentials — per-tenant secrets (Gmail OAuth refresh tokens,
-- Twilio account SIDs, Cal.com API keys, etc). Encrypted blob; the
-- AES-256-GCM helper ships in Phase 2. Until then this table is unused.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenant_credentials (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider               TEXT NOT NULL,            -- 'gmail' | 'twilio' | 'retell' | 'calcom' | 'google_calendar' | 'anthropic'
  encrypted_credentials  JSONB NOT NULL,           -- AES-256-GCM blob (Phase 2)
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_tenant_credentials_tenant ON tenant_credentials(tenant_id);

DROP TRIGGER IF EXISTS trg_tenant_credentials_updated ON tenant_credentials;
CREATE TRIGGER trg_tenant_credentials_updated
  BEFORE UPDATE ON tenant_credentials
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ------------------------------------------------------------
-- Seed the default tenant. PR2 backfills every existing row to point
-- at this tenant's id. The slug 'default' is the lookup key used by
-- getDefaultTenantId() in src/lib/tenant.ts.
-- ------------------------------------------------------------
INSERT INTO tenants (slug, name, status, plan) VALUES
  ('default', 'Default Tenant', 'active', 'starter')
ON CONFLICT (slug) DO NOTHING;
