import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createSession } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';
import { rateLimit } from '@/lib/rate-limit';
import { hashPassword, verifyPassword } from '@/lib/password';
import { getDefaultTenantId } from '@/lib/tenant';
import { createChildLogger } from '@/lib/logger';

const SESSION_COOKIE = 'sf_session';
const SESSION_TTL_HOURS = 24;

const log = createChildLogger('auth-login');

// Accepts either { email, password } (new flow) or just { password } (legacy
// single-admin fallback that triggers the ADMIN_PASSWORD bootstrap). The
// legacy shape lets the existing login form keep working unchanged for the
// first deploy until the UI sends an email field.
const LoginSchema = z.object({
  email: z.string().email().optional(),
  password: z.string().min(1, 'Password is required'),
});

export async function POST(request: NextRequest) {
  try {
    // Rate limit: 5 login attempts per minute per IP
    const ip = request.headers.get('x-forwarded-for') || 'unknown';
    const limited = rateLimit(`login:${ip}`, 5, 60_000);
    if (limited) return limited;

    const body = await request.json();
    const parsed = LoginSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }

    const supabase = getSupabase();
    const presentedPassword = parsed.data.password;
    const presentedEmail = parsed.data.email?.trim().toLowerCase();

    // --- Path 1: email + password against the users table ---
    if (presentedEmail) {
      const { data: row } = await supabase
        .from('users')
        .select('id, tenant_id, password_hash, role')
        .ilike('email', presentedEmail)
        .maybeSingle();

      const user = row as { id: string; tenant_id: string; password_hash: string; role: string } | null;
      if (!user) {
        return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
      }

      const ok = await verifyPassword(presentedPassword, user.password_hash);
      if (!ok) {
        return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
      }

      const sessionId = await createSession(user.id, user.tenant_id);

      // Best-effort last_login_at update
      await supabase
        .from('users')
        .update({ last_login_at: new Date().toISOString() })
        .eq('id', user.id);

      return buildSessionCookieResponse(sessionId);
    }

    // --- Path 2: legacy ADMIN_PASSWORD bootstrap ---
    // No email supplied → match against ADMIN_PASSWORD env. If it matches
    // AND no admin user exists yet for the default tenant, seed one. Logs
    // the bootstrap loudly so it's visible in the audit trail.
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminPassword) {
      return NextResponse.json(
        { error: 'Email required (or set ADMIN_PASSWORD for bootstrap)' },
        { status: 400 },
      );
    }
    if (presentedPassword !== adminPassword) {
      return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
    }

    const tenantId = await getDefaultTenantId();
    const bootstrapEmail = (process.env.BOOTSTRAP_ADMIN_EMAIL || 'admin@cleardesk.local').toLowerCase();

    // Check if the bootstrap user already exists
    const { data: existingRow } = await supabase
      .from('users')
      .select('id')
      .eq('tenant_id', tenantId)
      .ilike('email', bootstrapEmail)
      .maybeSingle();
    const existing = existingRow as { id: string } | null;

    let userId: string;
    if (existing) {
      userId = existing.id;
    } else {
      log.warn(
        { bootstrapEmail, tenantId },
        'ADMIN_PASSWORD bootstrap: seeding initial admin user',
      );
      const passwordHash = await hashPassword(adminPassword);
      const { data: created, error } = await supabase
        .from('users')
        .insert({
          tenant_id: tenantId,
          email: bootstrapEmail,
          password_hash: passwordHash,
          name: 'Bootstrap Admin',
          role: 'admin',
        })
        .select('id')
        .single();
      if (error || !created) {
        log.error({ error }, 'Failed to seed bootstrap admin');
        return NextResponse.json({ error: 'Bootstrap failed' }, { status: 500 });
      }
      userId = (created as { id: string }).id;
    }

    const sessionId = await createSession(userId, tenantId);
    await supabase
      .from('users')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', userId);

    return buildSessionCookieResponse(sessionId);
  } catch (err) {
    // Surface the real error message in both the response (so the admin
    // sees it in the browser network tab) and the worker logs. Generic
    // "Internal server error" makes bootstrap problems undebuggable.
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.error({ err, message }, 'login route error');
    return NextResponse.json(
      { error: `Login failed: ${message}` },
      { status: 500 },
    );
  }
}

function buildSessionCookieResponse(sessionId: string): NextResponse {
  const response = NextResponse.json({ success: true });
  response.cookies.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_HOURS * 60 * 60,
  });
  return response;
}
