import { getSupabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { EventType, CaseEvent } from '@/types';

export async function logCaseEvent(params: {
  caseId: number;
  eventType: EventType;
  actor?: string;
  summary: string;
  metadata?: Record<string, unknown>;
  /**
   * Optional override. When omitted, tenant_id is auto-derived from the
   * parent email_cases row — caller doesn't need to know it. This keeps
   * existing logCaseEvent call-sites unchanged during the Phase 1 PR2
   * transition.
   */
  tenantId?: string;
}): Promise<void> {
  const supabase = getSupabase();

  // Phase 1 single-tenant: stamp the default tenant unless caller passed
  // one explicitly. PR2B + Phase 3 derive tenant_id from request context
  // (TenantContext) so cross-tenant logCaseEvent calls become impossible.
  let tenantId = params.tenantId;
  if (!tenantId) {
    const { getDefaultTenantId } = await import('@/lib/tenant');
    tenantId = await getDefaultTenantId();
  }

  const { error } = await supabase.from('case_events').insert({
    case_id: params.caseId,
    event_type: params.eventType,
    actor: params.actor || 'system',
    summary: params.summary,
    metadata: params.metadata || null,
    tenant_id: tenantId ?? null,
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
