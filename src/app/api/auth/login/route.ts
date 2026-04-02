import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createSession, setSessionCookie } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';

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
    await setSessionCookie(sessionId);

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
