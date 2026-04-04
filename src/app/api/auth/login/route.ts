import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createSession } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';

const SESSION_COOKIE = 'sf_session';
const SESSION_TTL_HOURS = 24;

const LoginSchema = z.object({
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

    const adminPassword = process.env.ADMIN_PASSWORD || 'admin';

    if (parsed.data.password !== adminPassword) {
      return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
    }

    const sessionId = await createSession();

    // Set cookie directly on the response for reliability
    const response = NextResponse.json({ success: true });
    response.cookies.set(SESSION_COOKIE, sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_TTL_HOURS * 60 * 60,
    });

    return response;
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
