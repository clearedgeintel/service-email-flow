import { getSupabase } from './supabase';
import { createChildLogger } from './logger';

const log = createChildLogger('tenant');

/**
 * The tenant + user identity attached to every request that reaches a
 * service or DB query in multi-tenant mode. Phase 1 PR3 wires this into
 * requireAuth(); until then, services and routes get the default tenant
 * via getDefaultTenantId() so behavior matches single-tenant.
 */
export interface TenantContext {
  tenantId: string;       // UUID
  userId: string;         // UUID
  userEmail: string;
  userRole: 'admin' | 'super_admin';
  tenantSlug: string;
  tenantName: string;
}

/**
 * Public shape of a tenant — what gets returned by listTenants() and the
 * future Settings > Tenants UI in Phase 3.
 */
export interface Tenant {
  id: string;
  slug: string;
  name: string;
  status: 'active' | 'suspended' | 'trialing';
  plan: string;
  created_at: string;
  updated_at: string;
}

const DEFAULT_TENANT_SLUG = 'default';

// Module-level cache of the default tenant id. It never changes in a running
// process (it's a singleton seeded by migration 021), so cache forever after
// the first hit. Tests can reset via `_resetDefaultTenantCache`.
let defaultTenantIdCache: string | null = null;

/**
 * Fetch and cache the id of the seeded "Default Tenant" row. Used during
 * Phase 1 by:
 *   - PR2's tenant_id backfill (where every existing row maps here)
 *   - any service / API route call-site that hasn't been threaded with a
 *     real TenantContext yet (preserves single-tenant behavior)
 *
 * Throws if the default tenant row hasn't been seeded — that means
 * migration 021 wasn't applied, which is a hard error.
 */
export async function getDefaultTenantId(): Promise<string> {
  if (defaultTenantIdCache) return defaultTenantIdCache;

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('tenants')
    .select('id')
    .eq('slug', DEFAULT_TENANT_SLUG)
    .single();

  if (error || !data) {
    log.error({ error }, 'Default tenant not found — run migration 021');
    throw new Error(
      `Default tenant (slug="${DEFAULT_TENANT_SLUG}") not found. Run migration 021_multi_tenant_foundation in Supabase.`,
    );
  }

  defaultTenantIdCache = (data as { id: string }).id;
  return defaultTenantIdCache;
}

/**
 * Look up a tenant by its UUID. Returns null if the tenant doesn't exist
 * (callers should treat that as 404 / unauthorized).
 */
export async function getTenantById(tenantId: string): Promise<Tenant | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('tenants')
    .select('id, slug, name, status, plan, created_at, updated_at')
    .eq('id', tenantId)
    .single();
  if (error || !data) return null;
  return data as Tenant;
}

/**
 * Look up a tenant by slug — used by the (future) subdomain router in
 * Phase 3 to resolve "profix.cleardesk.app" → tenant row.
 */
export async function getTenantBySlug(slug: string): Promise<Tenant | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('tenants')
    .select('id, slug, name, status, plan, created_at, updated_at')
    .eq('slug', slug)
    .single();
  if (error || !data) return null;
  return data as Tenant;
}

/**
 * Test-only: reset the in-memory default-tenant cache between tests.
 * The leading underscore signals "don't call from production code".
 */
export function _resetDefaultTenantCache(): void {
  defaultTenantIdCache = null;
}
