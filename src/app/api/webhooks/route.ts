import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';
import { generateWebhookSecret, WEBHOOK_EVENT_TYPES } from '@/services/webhook.service';

const CreateSchema = z.object({
  name: z.string().min(1).max(100),
  url: z.string().url(),
  events: z.array(z.enum(WEBHOOK_EVENT_TYPES)).min(1),
  description: z.string().max(500).optional(),
  active: z.boolean().optional(),
});

export async function GET() {
  const authError = await requireAuth();
  if (authError) return authError;

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('webhook_subscriptions')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    subscriptions: data || [],
    available_events: WEBHOOK_EVENT_TYPES,
  });
}

export async function POST(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  const body = await request.json();
  const parsed = CreateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const supabase = getSupabase();
  const { getDefaultTenantId } = await import('@/lib/tenant');
  const tenantId = await getDefaultTenantId();

  const { data, error } = await supabase
    .from('webhook_subscriptions')
    .insert({
      tenant_id: tenantId,
      name: parsed.data.name,
      url: parsed.data.url,
      secret: generateWebhookSecret(),
      events: parsed.data.events,
      description: parsed.data.description || null,
      active: parsed.data.active ?? true,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ subscription: data }, { status: 201 });
}
