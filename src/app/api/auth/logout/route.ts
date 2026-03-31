import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { destroySession, clearSessionCookie } from '@/lib/auth';

export async function POST() {
  try {
    const cookieStore = await cookies();
    const sessionId = cookieStore.get('sf_session')?.value;

    if (sessionId) {
      await destroySession(sessionId);
    }

    await clearSessionCookie();

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
