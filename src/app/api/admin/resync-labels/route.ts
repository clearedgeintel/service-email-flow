import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';
import { syncMessageLabel } from '@/lib/gmail-labels';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('resync-labels');

export async function POST() {
  const authError = await requireAuth();
  if (authError) return authError;

  const supabase = getSupabase();

  // Fetch all non-archived cases with a gmail_message_id
  const { data, error } = await supabase
    .from('email_cases')
    .select('id, gmail_message_id, status')
    .not('gmail_message_id', 'is', null)
    .is('archived_at', null)
    .order('received_at', { ascending: false })
    .limit(2000);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const cases = (data || []) as Array<{ id: number; gmail_message_id: string; status: string }>;

  let synced = 0;
  let failed = 0;

  // Process sequentially to respect Gmail API rate limits
  for (const row of cases) {
    try {
      await syncMessageLabel(row.gmail_message_id, row.status);
      synced++;
    } catch (err) {
      failed++;
      log.warn({ caseId: row.id, err }, 'Failed to sync label');
    }
  }

  log.info({ synced, failed, total: cases.length }, 'Label resync complete');

  return NextResponse.json({
    success: true,
    total: cases.length,
    synced,
    failed,
  });
}
