import { getSupabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { EventType, CaseEvent } from '@/types';

export async function logCaseEvent(params: {
  caseId: number;
  eventType: EventType;
  actor?: string;
  summary: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const supabase = getSupabase();

  const { error } = await supabase.from('case_events').insert({
    case_id: params.caseId,
    event_type: params.eventType,
    actor: params.actor || 'system',
    summary: params.summary,
    metadata: params.metadata || null,
  });

  if (error) {
    logger.error({ error, caseId: params.caseId }, 'Failed to log case event');
  }
}

export async function getCaseTimeline(caseId: number): Promise<CaseEvent[]> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('case_events')
    .select('*')
    .eq('case_id', caseId)
    .order('created_at', { ascending: true });

  if (error) {
    logger.error({ error, caseId }, 'Failed to fetch case timeline');
    return [];
  }

  return data as CaseEvent[];
}
