import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';
import { invalidateConfigCache } from '@/lib/config';

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
  const supabase = getSupabase();

  const entries = Object.entries(body);
  if (entries.length === 0) {
    return NextResponse.json({ error: 'No settings provided' }, { status: 400 });
  }

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
