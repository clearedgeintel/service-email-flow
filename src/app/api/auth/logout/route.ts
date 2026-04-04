import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { destroySession } from '@/lib/auth';

const SESSION_COOKIE = 'sf_session';

export async function POST() {
  try {
    const cookieStore = await cookies();
    const sessionId = cookieStore.get(SESSION_COOKIE)?.value;

    if (sessionId) {
      await destroySession(sessionId);
    }

    // Clear cookie directly on the response
    const response = NextResponse.json({ success: true });
    response.cookies.set(SESSION_COOKIE, '', {
      httpOnly: true,
      path: '/',
      maxAge: 0,
    });

    return response;
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
