import { getSupabase } from '@/lib/supabase';
import { createChildLogger } from '@/lib/logger';

const log = createChildLogger('smart');

// --- Classification Feedback ---

export interface FeedbackInput {
  caseId: number;
  correctedIntent?: string;
  correctedUrgency?: string;
  correctedTrade?: string;
  notes?: string;
  actor?: string;
}

/** Record admin feedback when a classification is corrected */
export async function recordFeedback(input: FeedbackInput): Promise<void> {
  const supabase = getSupabase();

  // Get original classification
  const { data: row, error: fetchError } = await supabase
    .from('email_cases')
    .select('intent, urgency_level, trade, confidence')
    .eq('id', input.caseId)
    .single();

  if (fetchError || !row) {
    throw new Error(`Case #${input.caseId} not found`);
  }

  // Insert feedback record
  const { error: insertError } = await supabase
    .from('classification_feedback')
    .insert({
      case_id: input.caseId,
      original_intent: row.intent,
      corrected_intent: input.correctedIntent || row.intent,
      original_urgency: row.urgency_level,
      corrected_urgency: input.correctedUrgency || row.urgency_level,
      original_trade: row.trade,
      corrected_trade: input.correctedTrade || row.trade,
      original_confidence: row.confidence,
      actor: input.actor || 'admin',
      notes: input.notes,
    });

  if (insertError) {
    throw new Error(`Failed to record feedback: ${insertError.message}`);
  }

  // Apply corrections to the case
  const updates: Record<string, unknown> = {};
  if (input.correctedIntent) updates.intent = input.correctedIntent;
  if (input.correctedUrgency) updates.urgency_level = input.correctedUrgency;
  if (input.correctedTrade) updates.trade = input.correctedTrade;

  if (Object.keys(updates).length > 0) {
    await supabase.from('email_cases').update(updates).eq('id', input.caseId);
  }

  log.info({ caseId: input.caseId, corrections: updates }, 'Classification feedback recorded');
}

/** Get feedback stats for evaluating classification accuracy */
export async function getFeedbackStats(): Promise<{
  totalFeedback: number;
  intentCorrections: Record<string, number>;
  accuracyRate: number;
}> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('classification_feedback')
    .select('original_intent, corrected_intent');

  if (error || !data) {
    return { totalFeedback: 0, intentCorrections: {}, accuracyRate: 1 };
  }

  const intentCorrections: Record<string, number> = {};
  let correctCount = 0;

  for (const row of data) {
    const r = row as Record<string, string>;
    if (r.original_intent !== r.corrected_intent) {
      const key = `${r.original_intent} → ${r.corrected_intent}`;
      intentCorrections[key] = (intentCorrections[key] || 0) + 1;
    } else {
      correctCount++;
    }
  }

  return {
    totalFeedback: data.length,
    intentCorrections,
    accuracyRate: data.length > 0 ? correctCount / data.length : 1,
  };
}

// --- Repeat Customer Detection ---

export interface CustomerProfile {
  email: string;
  totalCases: number;
  firstContact: string;
  lastContact: string;
  trades: string[];
  intents: string[];
  isRepeat: boolean;
  avgUrgency: string;
  openCases: number;
}

/** Get a customer's history and profile */
export async function getCustomerProfile(email: string): Promise<CustomerProfile | null> {
  const supabase = getSupabase();
  const normalizedEmail = email.toLowerCase().trim();

  const { data, error } = await supabase
    .from('email_cases')
    .select('id, received_at, trade, intent, urgency_level, status')
    .or(`customer_email.eq.${normalizedEmail},from_email.eq.${normalizedEmail}`)
    .order('received_at', { ascending: true });

  if (error || !data || data.length === 0) {
    return null;
  }

  const trades = [...new Set(data.map((r: Record<string, unknown>) => r.trade as string).filter(Boolean))];
  const intents = [...new Set(data.map((r: Record<string, unknown>) => r.intent as string).filter(Boolean))];
  const openCases = data.filter((r: Record<string, unknown>) =>
    !['CLOSED', 'NEEDS_MANUAL_CALL'].includes(r.status as string),
  ).length;

  // Determine most common urgency
  const urgencyCounts: Record<string, number> = {};
  for (const row of data) {
    const u = (row as Record<string, unknown>).urgency_level as string;
    if (u) urgencyCounts[u] = (urgencyCounts[u] || 0) + 1;
  }
  const avgUrgency = Object.entries(urgencyCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'ROUTINE';

  return {
    email: normalizedEmail,
    totalCases: data.length,
    firstContact: (data[0] as Record<string, string>).received_at,
    lastContact: (data[data.length - 1] as Record<string, string>).received_at,
    trades,
    intents,
    isRepeat: data.length > 1,
    avgUrgency,
    openCases,
  };
}

/** Get top repeat customers */
export async function getRepeatCustomers(limit: number = 20): Promise<CustomerProfile[]> {
  const supabase = getSupabase();

  // Get customer emails with case counts
  const { data, error } = await supabase
    .from('email_cases')
    .select('customer_email');

  if (error || !data) return [];

  // Count occurrences
  const emailCounts: Record<string, number> = {};
  for (const row of data) {
    const email = (row as Record<string, string>).customer_email;
    if (email && email !== 'redacted@redacted.com') {
      emailCounts[email] = (emailCounts[email] || 0) + 1;
    }
  }

  // Get top repeat emails
  const repeatEmails = Object.entries(emailCounts)
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([email]) => email);

  // Build profiles
  const profiles: CustomerProfile[] = [];
  for (const email of repeatEmails) {
    const profile = await getCustomerProfile(email);
    if (profile) profiles.push(profile);
  }

  return profiles;
}

// --- Trend Detection ---

export interface TrendData {
  period: string;
  intentTrends: Record<string, number>;
  tradeTrends: Record<string, number>;
  urgencyTrends: Record<string, number>;
  avgConfidence: number;
  totalCases: number;
}

/** Get intent/trade/urgency trends over the last N days */
export async function getTrends(days: number = 30): Promise<TrendData[]> {
  const supabase = getSupabase();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('email_cases')
    .select('received_at, intent, trade, urgency_level, confidence')
    .gte('received_at', since)
    .order('received_at', { ascending: true });

  if (error || !data) return [];

  // Group by week
  const weekBuckets: Record<string, Array<Record<string, unknown>>> = {};
  for (const row of data) {
    const r = row as Record<string, unknown>;
    const date = new Date(r.received_at as string);
    const weekStart = new Date(date);
    weekStart.setDate(date.getDate() - date.getDay());
    const key = weekStart.toISOString().split('T')[0];
    if (!weekBuckets[key]) weekBuckets[key] = [];
    weekBuckets[key].push(r);
  }

  return Object.entries(weekBuckets).map(([period, rows]) => {
    const intentTrends: Record<string, number> = {};
    const tradeTrends: Record<string, number> = {};
    const urgencyTrends: Record<string, number> = {};
    let totalConfidence = 0;
    let confCount = 0;

    for (const r of rows) {
      if (r.intent) intentTrends[r.intent as string] = (intentTrends[r.intent as string] || 0) + 1;
      if (r.trade) tradeTrends[r.trade as string] = (tradeTrends[r.trade as string] || 0) + 1;
      if (r.urgency_level) urgencyTrends[r.urgency_level as string] = (urgencyTrends[r.urgency_level as string] || 0) + 1;
      if (typeof r.confidence === 'number') {
        totalConfidence += r.confidence;
        confCount++;
      }
    }

    return {
      period,
      intentTrends,
      tradeTrends,
      urgencyTrends,
      avgConfidence: confCount > 0 ? Math.round((totalConfidence / confCount) * 100) / 100 : 0,
      totalCases: rows.length,
    };
  });
}
