import { getSupabase } from '@/lib/supabase';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('poll-history');

export interface PollRecord {
  id: number;
  queue_name: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  messages_found: number;
  cases_inserted: number;
  error: string | null;
  metadata: Record<string, unknown> | null;
}

/**
 * Record a poll cycle. Returns an updater function that accepts the final
 * counts/error and writes the complete record.
 */
export function startPoll(queueName: string): {
  finish: (result: {
    messagesFound?: number;
    casesInserted?: number;
    error?: string;
    metadata?: Record<string, unknown>;
  }) => Promise<void>;
} {
  const startedAt = new Date();
  let pollId: number | null = null;

  // Fire-and-forget insert so we don't block the poll on DB latency
  (async () => {
    try {
      const supabase = getSupabase();
      const { getDefaultTenantId } = await import('@/lib/tenant');
      const tenantId = await getDefaultTenantId();
      const { data } = await supabase
        .from('poll_history')
        .insert({
          tenant_id: tenantId,
          queue_name: queueName,
          started_at: startedAt.toISOString(),
        })
        .select('id')
        .single();
      if (data) pollId = (data as { id: number }).id;
    } catch (err) {
      log.debug({ err }, 'poll-history insert failed (non-critical)');
    }
  })();

  return {
    finish: async (result) => {
      const finishedAt = new Date();
      const durationMs = finishedAt.getTime() - startedAt.getTime();
      try {
        const supabase = getSupabase();
        if (pollId !== null) {
          await supabase
            .from('poll_history')
            .update({
              finished_at: finishedAt.toISOString(),
              duration_ms: durationMs,
              messages_found: result.messagesFound || 0,
              cases_inserted: result.casesInserted || 0,
              error: result.error || null,
              metadata: result.metadata || null,
            })
            .eq('id', pollId);
        } else {
          // Fallback: insert a complete record if the initial insert didn't land
          const { getDefaultTenantId } = await import('@/lib/tenant');
          const tenantId = await getDefaultTenantId();
          await supabase.from('poll_history').insert({
            tenant_id: tenantId,
            queue_name: queueName,
            started_at: startedAt.toISOString(),
            finished_at: finishedAt.toISOString(),
            duration_ms: durationMs,
            messages_found: result.messagesFound || 0,
            cases_inserted: result.casesInserted || 0,
            error: result.error || null,
            metadata: result.metadata || null,
          });
        }
      } catch (err) {
        log.debug({ err }, 'poll-history finish failed (non-critical)');
      }
    },
  };
}

/** Prune poll history older than N days (default 30) */
export async function prunePollHistory(days: number = 30): Promise<number> {
  const supabase = getSupabase();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('poll_history')
    .delete()
    .lt('started_at', cutoff)
    .select('id');
  if (error) return 0;
  return data?.length || 0;
}
