import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { exportCustomerData, forgetCustomer } from '@/services/retention.service';

const EmailSchema = z.object({
  email: z.string().email('Valid email address required'),
});

/** GET /api/privacy?email=... — Export all data for a customer email (GDPR) */
export async function GET(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  const email = request.nextUrl.searchParams.get('email');
  const parsed = EmailSchema.safeParse({ email });

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 },
    );
  }

  try {
    const data = await exportCustomerData(parsed.data.email);
    return NextResponse.json({
      email: parsed.data.email,
      exported_at: new Date().toISOString(),
      ...data,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Export failed' },
      { status: 500 },
    );
  }
}

/** DELETE /api/privacy — Purge all PII for a customer email (GDPR right to forget) */
export async function DELETE(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const body = await request.json();
    const parsed = EmailSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }

    const result = await forgetCustomer(parsed.data.email);
    return NextResponse.json({
      email: parsed.data.email,
      forgotten_at: new Date().toISOString(),
      ...result,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Forget failed' },
      { status: 500 },
    );
  }
}
