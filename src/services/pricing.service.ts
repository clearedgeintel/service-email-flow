import { getSupabase } from '@/lib/supabase';
import { createChildLogger } from '@/lib/logger';
import { PricingItem } from '@/types';

const log = createChildLogger('pricing');

/** Find matching pricing items by keyword overlap with search text */
export async function lookupPricing(searchText: string, trade?: string): Promise<PricingItem[]> {
  const supabase = getSupabase();

  // Fetch all active pricing items (optionally filtered by trade)
  let query = supabase
    .from('pricing_items')
    .select('*')
    .eq('active', true);

  if (trade && trade !== 'unknown' && trade !== 'both') {
    query = query.eq('trade', trade);
  }

  const { data: items, error } = await query;

  if (error || !items) {
    log.error({ error }, 'Failed to fetch pricing items');
    return [];
  }

  const normalized = searchText.toLowerCase();

  // Match items where any keyword appears in the search text
  const matches = (items as PricingItem[]).filter((item) =>
    item.keywords.some((kw) => normalized.includes(kw.toLowerCase())),
  );

  return matches;
}

/** Format pricing items as plain text for LLM context */
export function formatPricingForPrompt(items: PricingItem[]): string {
  return items
    .map((m) => `${m.service}: $${m.price_min}–$${m.price_max} ${m.unit}`)
    .join('\n');
}
