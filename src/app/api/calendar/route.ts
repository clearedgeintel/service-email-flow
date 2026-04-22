import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { listAllEvents, listAllFreeSlots, getActiveProviders } from '@/services/calendar';

const QuerySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  include_slots: z.enum(['true', 'false']).default('true'),
});

export async function GET(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  const raw = Object.fromEntries(request.nextUrl.searchParams.entries());
  const parsed = QuerySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 },
    );
  }

  const from = new Date(parsed.data.from);
  const to = new Date(parsed.data.to);

  if (to.getTime() - from.getTime() > 60 * 24 * 60 * 60 * 1000) {
    return NextResponse.json({ error: 'Range cannot exceed 60 days' }, { status: 400 });
  }

  const [providers, events, slots] = await Promise.all([
    getActiveProviders(),
    listAllEvents(from, to),
    parsed.data.include_slots === 'true' ? listAllFreeSlots(from, to) : Promise.resolve([]),
  ]);

  return NextResponse.json({
    providers: providers.map((p) => ({ id: p.id, label: p.label })),
    events,
    slots,
  });
}
