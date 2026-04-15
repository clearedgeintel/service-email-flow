import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { getTemplate, updateTemplate } from '@/services/template.service';

const UpdateSchema = z.object({
  subject: z.string().max(300).nullable().optional(),
  body: z.string().min(1).max(10000).optional(),
}).refine((data) => data.subject !== undefined || data.body !== undefined, {
  message: 'At least one of subject or body is required',
});

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const authError = await requireAuth();
  if (authError) return authError;

  const { key } = await params;
  const template = await getTemplate(key);
  if (!template) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }
  return NextResponse.json({ template });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const authError = await requireAuth();
  if (authError) return authError;

  const { key } = await params;
  const body = await request.json();
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 },
    );
  }

  const template = await updateTemplate(key, parsed.data);
  if (!template) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }
  return NextResponse.json({ template });
}
