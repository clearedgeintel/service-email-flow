import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { seedDefaultTemplates } from '@/services/template.service';

export async function POST() {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const result = await seedDefaultTemplates();
    return NextResponse.json({
      success: true,
      ...result,
      message: result.inserted > 0
        ? `Seeded ${result.inserted} default template${result.inserted === 1 ? '' : 's'}.`
        : 'All default templates already exist.',
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Seed failed' },
      { status: 500 },
    );
  }
}
