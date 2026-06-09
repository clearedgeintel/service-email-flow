import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSupabase } from './supabase';
import type { TenantContext } from './tenant';

const SESSION_COOKIE = 'sf_session';
const SESSION_TTL_HOURS = 24;

/**
 * Create a new multi-tenant session. Writes to the new `sessions` table
 * created in migration 021 — replaces the single-row admin_sessions
 * (which stays in place for in-flight sessions during the deploy window;
 * a follow-up migration drops it).
 */
export async function createSession(userId: string, tenantId: string): Promise<string> {
  const supabase = getSupabase();
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000).toISOString();

  const { error } = await supabase
    .from('sessions')
    .insert({ id, user_id: userId, tenant_id: tenantId, expires_at: expiresAt });

  if (error) {
    throw new Error(`Failed to create session: ${error.message}`);
  }

  return id;
}

/**
 * Destroy a session. Tries both the new `sessions` table and the legacy
 * `admin_sessions` so old cookies clean themselves up.
 */
export async function destroySession(sessionId: string): Promise<void> {
  const supabase = getSupabase();
  await Promise.all([
    supabase.from('sessions').delete().eq('id', sessionId),
    supabase.from('admin_sessions').delete().eq('id', sessionId),
  ]);
}

/**
 * Validate a session id. Returns true if the session is valid in either
 * the new `sessions` table or the legacy `admin_sessions` (transition
 * window). Used by the backward-compat requireAuth() guard.
 */
export async function validateSession(sessionId: string): Promise<boolean> {
  const supabase = getSupabase();

  // Try new sessions table first
  const { data: newSession } = await supabase
    .from('sessions')
    .select('id, expires_at')
    .eq('id', sessionId)
    .maybeSingle();

  if (newSession) {
    if (new Date((newSession as { expires_at: string }).expires_at) < new Date()) {
      await supabase.from('sessions').delete().eq('id', sessionId);
      return false;
    }
    return true;
  }

  // Fall through to legacy admin_sessions
  const { data: legacy } = await supabase
    .from('admin_sessions')
    .select('id, expires_at')
    .eq('id', sessionId)
    .maybeSingle();

  if (!legacy) return false;
  if (new Date((legacy as { expires_at: string }).expires_at) < new Date()) {
    await supabase.from('admin_sessions').delete().eq('id', sessionId);
    return false;
  }
  return true;
}

/**
 * Load the full tenant + user context for a session id. Returns null on
 * any failure. Used by requireTenantContext().
 */
export async function loadSessionContext(sessionId: string): Promise<TenantContext | null> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from('sessions')
    .select(`
      id, expires_at,
      user_id, tenant_id,
      users:users!sessions_user_id_fkey ( email, role ),
      tenants:tenants!sessions_tenant_id_fkey ( slug, name )
    `)
    .eq('id', sessionId)
    .maybeSingle();

  if (!data) return null;
  const row = data as {
    expires_at: string;
    user_id: string;
    tenant_id: string;
    users: { email: string; role: string } | { email: string; role: string }[] | null;
    tenants: { slug: string; name: string } | { slug: string; name: string }[] | null;
  };

  if (new Date(row.expires_at) < new Date()) {
    await supabase.from('sessions').delete().eq('id', sessionId);
    return null;
  }

  // Supabase joined-rows can come back as either object or array depending
  // on FK type — normalize both shapes.
  const user = Array.isArray(row.users) ? row.users[0] : row.users;
  const tenant = Array.isArray(row.tenants) ? row.tenants[0] : row.tenants;
  if (!user || !tenant) return null;

  return {
    tenantId: row.tenant_id,
    userId: row.user_id,
    userEmail: user.email,
    userRole: user.role === 'super_admin' ? 'super_admin' : 'admin',
    tenantSlug: tenant.slug,
    tenantName: tenant.name,
  };
}

export async function setSessionCookie(sessionId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_HOURS * 60 * 60,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, '', {
    httpOnly: true,
    path: '/',
    maxAge: 0,
  });
}

/**
 * Backward-compatible auth guard. Returns null if authenticated, or a
 * 401 Response. New routes that need tenant context should call
 * requireTenantContext() instead.
 */
export async function requireAuth(): Promise<NextResponse | null> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;

  if (!sessionId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const valid = await validateSession(sessionId);
  if (!valid) {
    return NextResponse.json({ error: 'Session expired' }, { status: 401 });
  }

  return null;
}

/**
 * New auth guard that returns the resolved tenant + user context on
 * success. Use this when a route needs to know who's calling and which
 * tenant they belong to. Legacy admin_sessions (no user/tenant) cannot
 * be resolved into a context — caller should fall back to default
 * tenant or force re-login.
 */
export async function requireTenantContext(): Promise<TenantContext | NextResponse> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;

  if (!sessionId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const ctx = await loadSessionContext(sessionId);
  if (ctx) return ctx;

  // Session might be a legacy admin_sessions row with no user/tenant
  // attached. Best we can do is reject and let the user re-login.
  return NextResponse.json(
    { error: 'Session needs refresh — please log out and log in again' },
    { status: 401 },
  );
}
