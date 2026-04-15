import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { listTemplates } from '@/services/template.service';

export async function GET() {
  const authError = await requireAuth();
  if (authError) return authError;

  const templates = await listTemplates();
  return NextResponse.json({ templates });
}
