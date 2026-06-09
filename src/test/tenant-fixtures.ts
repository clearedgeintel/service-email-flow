/**
 * Multi-tenant test fixtures.
 *
 * During Phase 1 the system runs single-tenant (one Default Tenant
 * seeded by migration 021), so tests assume DEFAULT_TENANT_ID for
 * any tenant-scoped operation. Phase 3 introduces multi-tenant test
 * cases.
 */

/** A stable UUID used as the default tenant in unit tests. */
export const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-00000000d3fa';

/** A second tenant UUID for cross-tenant isolation tests (RLS coverage). */
export const SECOND_TENANT_ID = '00000000-0000-0000-0000-0000000022d2';

/** Build a TenantContext stub for routes/services that consume one. */
export function buildTestTenantContext(overrides: Partial<{
  tenantId: string;
  userId: string;
  userEmail: string;
  userRole: 'admin' | 'super_admin';
  tenantSlug: string;
  tenantName: string;
}> = {}) {
  return {
    tenantId: DEFAULT_TENANT_ID,
    userId: '00000000-0000-0000-0000-000000000usr',
    userEmail: 'test@example.com',
    userRole: 'admin' as const,
    tenantSlug: 'default',
    tenantName: 'Default Tenant',
    ...overrides,
  };
}
