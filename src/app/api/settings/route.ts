import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';
import { invalidateConfigCache } from '@/lib/config';
import { SettingsUpdateSchema } from '@/lib/validation';

export async function GET() {
  const authError = await requireAuth();
  if (authError) return authError;

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('settings')
    .select('key, value, updated_at')
    .order('key');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Convert to { key: value } object
  const settings: Record<string, unknown> = {};
  for (const row of data || []) {
    settings[row.key] = row.value;
  }

  return NextResponse.json({ settings });
}

export async function PUT(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  const body = await request.json();
  const parsed = SettingsUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 },
    );
  }

  const supabase = getSupabase();
  const entries = Object.entries(parsed.data);

  // Stamp tenant_id on each upsert. PK is still 'key' alone in Phase 1
  // PR2, so the onConflict still matches by key; tenant_id ends up on
  // every row for forward-compatibility with PR2B's composite PK move.
  const { getDefaultTenantId } = await import('@/lib/tenant');
  const tenantId = await getDefaultTenantId();

  for (const [key, value] of entries) {
    await supabase
      .from('settings')
      .upsert(
        {
          tenant_id: tenantId,
          key,
          value: JSON.parse(JSON.stringify(value)),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'key' },
      );
  }

  // Bust config cache
  invalidateConfigCache();

  return NextResponse.json({ success: true, updated: entries.length });
}
