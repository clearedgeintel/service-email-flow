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

  for (const [key, value] of entries) {
    await supabase
      .from('settings')
      .upsert(
        { key, value: JSON.parse(JSON.stringify(value)), updated_at: new Date().toISOString() },
        { onConflict: 'key' },
      );
  }

  // Bust config cache
  invalidateConfigCache();

  return NextResponse.json({ success: true, updated: entries.length });
}
