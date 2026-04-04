# Multi-Tenant Architecture — ServiceFlow

> This document describes the architecture for transforming ServiceFlow from a single-tenant app (one Gmail inbox, one business) into a multi-tenant platform where each tenant is a separate service business with their own inbox, settings, pricing, and admin users.

---

## Overview

| Current (Single-Tenant) | Multi-Tenant |
|--------------------------|-------------|
| One Gmail inbox (env vars) | Per-tenant Gmail OAuth stored in DB |
| One `ADMIN_PASSWORD` | Per-tenant users with email/password (bcrypt) |
| Global settings table | Settings keyed by `(tenant_id, key)` |
| Global pricing table | Pricing scoped by `tenant_id` |
| One set of Twilio/Slack creds | Per-tenant credentials encrypted in DB |
| Workers poll one inbox | Fan-out: workers poll all active tenants |

---

## 1. Database Schema

### 1.1 New Tables

```sql
-- Root entity: each tenant is a business
CREATE TABLE tenants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          TEXT UNIQUE NOT NULL,           -- "profix-electric"
  name          TEXT NOT NULL,                  -- "ProFix Electric & Plumbing"
  status        TEXT NOT NULL DEFAULT 'active', -- active, suspended, trial
  plan          TEXT NOT NULL DEFAULT 'starter',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Replaces ADMIN_PASSWORD with real user accounts
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,  -- bcrypt
  name          TEXT,
  role          TEXT NOT NULL DEFAULT 'admin', -- admin | viewer
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, email)
);

-- Per-tenant OAuth tokens, API keys (encrypted)
CREATE TABLE tenant_credentials (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL,  -- 'gmail' | 'twilio' | 'slack' | 'openai'
  credentials   TEXT NOT NULL,  -- AES-256-GCM encrypted JSON
  metadata      JSONB,          -- { gmail_send_as: "service@biz.com" }
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, provider)
);

-- Replaces admin_sessions with tenant-scoped sessions
CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 1.2 Add `tenant_id` to All Existing Tables

Every data table gets `tenant_id UUID NOT NULL REFERENCES tenants(id)`:

- `email_cases` — scope all case queries
- `settings` — PK becomes `(tenant_id, key)`
- `pricing_items` — each business has their own pricing
- `case_events` — denormalized for query performance
- `classification_feedback` — scope feedback to tenant

### 1.3 Migration Strategy

The migration is **additive and non-destructive**:

1. Create new tables (`tenants`, `users`, `tenant_credentials`, `sessions`)
2. Create a **default tenant** from existing data
3. Add `tenant_id` columns as **nullable** first
4. Backfill all existing rows with the default tenant ID
5. Alter columns to `NOT NULL`
6. Create composite indexes (tenant_id leading)
7. Drop `admin_sessions` (replaced by `sessions`)

---

## 2. Authentication

### 2.1 Current → Multi-Tenant Auth

| Current | Multi-Tenant |
|---------|-------------|
| `ADMIN_PASSWORD` env var | `users` table with bcrypt hashes |
| Session stores `id` + `expires_at` | Session stores `id` + `user_id` + `tenant_id` |
| `requireAuth()` returns `null` or `401` | `requireAuth()` returns `TenantContext` or `401` |

### 2.2 TenantContext Type

```typescript
interface TenantContext {
  tenantId: string;
  userId: string;
  userEmail: string;
  userRole: string;  // 'admin' | 'viewer'
}
```

Every API route gets the tenant context from the session:

```typescript
// Before (single-tenant):
const authError = await requireAuth();
if (authError) return authError;
const { data } = await supabase.from('email_cases').select('*');

// After (multi-tenant):
const auth = await requireAuth();
if (auth instanceof NextResponse) return auth;
const { tenantId } = auth;
const { data } = await supabase.from('email_cases').select('*').eq('tenant_id', tenantId);
```

### 2.3 Login Flow

```
POST /api/auth/login
Body: { email, password, tenant_slug? }

1. Resolve tenant from subdomain or slug
2. Lookup user by (tenant_id, email)
3. bcrypt.compare(password, user.password_hash)
4. Create session with (userId, tenantId)
5. Set httpOnly cookie
```

### 2.4 Tenant Resolution

**Primary:** Subdomain-based (e.g., `profix.serviceflow.app`)  
**Fallback:** `tenant_slug` field in login body  
**Implementation:** Next.js middleware extracts slug from `Host` header

---

## 3. Per-Tenant Credentials

### 3.1 Credential Storage

All external service credentials move from `.env` to the `tenant_credentials` table, encrypted with AES-256-GCM.

| Provider | Stored Credentials |
|----------|-------------------|
| `gmail` | `{ client_id, client_secret, refresh_token }` + metadata: `{ send_as }` |
| `twilio` | `{ account_sid, auth_token, from_number }` |
| `slack` | `{ webhook_url }` |
| `openai` | `{ api_key }` (optional — falls back to platform key) |

### 3.2 Encryption

```typescript
// src/lib/crypto.ts
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY = Buffer.from(process.env.CREDENTIALS_MASTER_KEY!, 'hex'); // 32 bytes

export function encrypt(data: object): string { /* AES-256-GCM */ }
export function decrypt(ciphertext: string): object { /* AES-256-GCM */ }
```

New env var: `CREDENTIALS_MASTER_KEY` (64-char hex string, 32 bytes)

### 3.3 Per-Tenant Client Factories

```typescript
// Before:
const gmail = getGmail();  // singleton from env vars

// After:
const gmail = await getGmailForTenant(tenantId);  // from encrypted DB credentials
```

Same pattern for Twilio, Slack. OpenAI can remain shared (platform key).

---

## 4. Worker Architecture

### 4.1 The Problem

Currently, one cron job polls one Gmail inbox. With N tenants, we need to poll N inboxes.

### 4.2 Fan-Out Pattern

```
Every 2 minutes:
  ┌─ Coordinator job ─┐
  │  Query: SELECT id  │
  │  FROM tenants       │
  │  WHERE status =     │
  │  'active'           │
  └────────────────────┘
       │
       ├── Enqueue: { tenantId: "tenant-1" }
       ├── Enqueue: { tenantId: "tenant-2" }
       └── Enqueue: { tenantId: "tenant-3" }
              │
              ▼
       Gmail intake worker
       (concurrency: 5)
       polls each tenant's inbox
```

### 4.3 Job Data

All jobs carry `tenantId`:

```typescript
interface TenantJobData {
  tenantId: string;
}

interface CaseJobData extends TenantJobData {
  caseId: number;
}
```

Every worker extracts `tenantId` from job data and uses it for:
- Scoping DB queries
- Getting tenant-specific Gmail/Twilio/Slack clients
- Getting tenant-specific config

---

## 5. Env Var Changes

### Removed (moved to per-tenant DB storage)
```
ADMIN_PASSWORD
GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, GMAIL_SEND_AS
TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER
BUSINESS_NAME, BUSINESS_PHONE, TECH_EMAIL, TECH_PHONE, OWNER_EMAIL
SLACK_WEBHOOK_URL
```

### Added
```
CREDENTIALS_MASTER_KEY=<64-char hex>   # AES-256-GCM key for credential encryption
```

### Kept (platform-level)
```
SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
REDIS_URL
OPENAI_API_KEY                         # shared unless tenants bring their own
SESSION_SECRET
```

---

## 6. API Route Changes

Every authenticated route changes from:

```typescript
const authError = await requireAuth();
if (authError) return authError;
```

To:

```typescript
const auth = await requireAuth();
if (auth instanceof NextResponse) return auth;
const { tenantId } = auth;
// All queries include .eq('tenant_id', tenantId)
```

**All 21 API route files** need this update. Additionally, routes that accept `[id]` params must verify the resource belongs to the tenant (query with both `id` and `tenant_id`).

---

## 7. New API Endpoints

### Tenant Onboarding
- `POST /api/tenants` — Create a new tenant (platform admin)
- `POST /api/tenants/:slug/users` — Invite a user to a tenant

### Credential Management
- `GET /api/credentials` — List configured providers for current tenant
- `PUT /api/credentials/gmail` — Start Gmail OAuth flow
- `GET /api/credentials/gmail/callback` — OAuth callback, store tokens
- `PUT /api/credentials/twilio` — Configure Twilio credentials
- `PUT /api/credentials/slack` — Configure Slack webhook

---

## 8. Security Invariants

1. **Every DB query MUST include `.eq('tenant_id', tenantId)`** — the most critical rule
2. **RLS as a backstop** — enable RLS on all tables as defense-in-depth
3. **Credentials encrypted at rest** — AES-256-GCM, never plaintext in DB
4. **Session carries tenant_id** — users cannot forge tenant context
5. **Resource ownership verified** — `[id]` params checked against tenant_id
6. **Per-tenant rate limiting** — prevent one tenant from degrading service
7. **Audit trail scoped** — case_events include tenant_id

---

## 9. Implementation Phases

### Phase A: Database Foundation
- Migration 007: new tables, add tenant_id, backfill, indexes
- `src/lib/crypto.ts` for credential encryption

### Phase B: Auth System
- Rewrite `src/lib/auth.ts` → TenantContext
- Add bcrypt, rewrite login route
- Create `src/middleware.ts` for subdomain resolution

### Phase C: Per-Tenant Clients
- `getGmailForTenant(tenantId)` factory
- `getTwilioForTenant(tenantId)` factory
- Tenant-scoped `getConfig(tenantId, key)`

### Phase D: API & Service Layer
- Update all 21 API routes for TenantContext
- Update all 10 service files to accept tenantId
- Credential management endpoints

### Phase E: Workers
- Fan-out coordinator for Gmail/followup/digest
- All workers extract tenantId from job data

### Phase F: Frontend & Onboarding
- Login with email/password
- Tenant setup wizard (connect Gmail, configure settings)
- Branding from tenant settings

---

## 10. Gmail OAuth Setup (Per-Tenant)

Instead of one set of env-var credentials, each tenant connects their own Gmail through an OAuth flow:

```
1. Admin clicks "Connect Gmail" in dashboard
2. Redirect to Google consent screen (using platform OAuth app)
3. User authorizes ServiceFlow for their Gmail
4. Callback stores encrypted tokens in tenant_credentials
5. Gmail intake worker uses these tokens to poll that tenant's inbox
```

The platform needs **one Google Cloud OAuth app** (Web Application type) with the callback URL pointing to `/api/credentials/gmail/callback`. Each tenant authorizes this app for their own Gmail account.

---

## 11. Data Model Diagram

```
tenants
  ├── users (login accounts)
  ├── tenant_credentials (gmail, twilio, slack tokens)
  ├── settings (business config, key-value)
  ├── pricing_items (service pricing)
  └── email_cases
       ├── case_events (audit log)
       └── classification_feedback
```

All relationships go through `tenant_id`. No cross-tenant references exist.
