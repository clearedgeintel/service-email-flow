import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { getConfig } from '@/lib/config';
import { getPublicCaseByToken } from '@/services/case-token.service';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  // No auth required — token IS the auth. Rate limit per IP to prevent enumeration.
  const ip = request.headers.get('x-forwarded-for') || 'unknown';
  const limited = rateLimit(`public-case:${ip}`, 30, 60_000);
  if (limited) return limited;

  const enabledRaw = await getConfig<unknown>('portal_enabled', true);
  const enabled = enabledRaw === true || enabledRaw === 'true';
  if (!enabled) {
    return NextResponse.json({ error: 'Portal disabled' }, { status: 503 });
  }

  const { token } = await params;
  if (!token || token.length < 10) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 400 });
  }

  const data = await getPublicCaseByToken(token);
  if (!data) {
    return NextResponse.json({ error: 'Case not found or link expired' }, { status: 404 });
  }

  return NextResponse.json({ case: data });
}
