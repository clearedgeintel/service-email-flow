import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSupabase } from './supabase';

const SESSION_COOKIE = 'sf_session';
const SESSION_TTL_HOURS = 24;

export async function createSession(): Promise<string> {
  const supabase = getSupabase();
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000).toISOString();

  await supabase.from('admin_sessions').insert({ id, expires_at: expiresAt });

  return id;
}

export async function destroySession(sessionId: string): Promise<void> {
  const supabase = getSupabase();
  await supabase.from('admin_sessions').delete().eq('id', sessionId);
}

export async function validateSession(sessionId: string): Promise<boolean> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from('admin_sessions')
    .select('id, expires_at')
    .eq('id', sessionId)
    .single();

  if (!data) return false;
  if (new Date(data.expires_at) < new Date()) {
    await supabase.from('admin_sessions').delete().eq('id', sessionId);
    return false;
  }

  return true;
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

/** Auth guard for API routes. Returns null if authenticated, or a 401 Response. */
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
