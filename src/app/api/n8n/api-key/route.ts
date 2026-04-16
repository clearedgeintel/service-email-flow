import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getOrCreateN8nApiKey, rotateN8nApiKey } from '@/lib/n8n-auth';

export async function GET() {
  const authError = await requireAuth();
  if (authError) return authError;

  const key = await getOrCreateN8nApiKey();
  return NextResponse.json({ api_key: key });
}

export async function POST() {
  const authError = await requireAuth();
  if (authError) return authError;

  const key = await rotateN8nApiKey();
  return NextResponse.json({ api_key: key, rotated: true });
}
