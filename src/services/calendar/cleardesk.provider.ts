import { getSupabase } from '@/lib/supabase';
import { createChildLogger } from '@/lib/logger';
import { CalendarEvent, CalendarProvider } from './types';

const log = createChildLogger('calendar-cleardesk');

/**
 * ClearDesk-native provider: surfaces bookings stored on email_cases.
 * Always available — no credentials needed. Represents the authoritative
 * view of appointments created through this platform.
 */
export const clearDeskProvider: CalendarProvider = {
  id: 'cleardesk',
  label: 'ClearDesk bookings',

  async isConfigured() {
    return true;
  },

  async listEvents(from: Date, to: Date): Promise<CalendarEvent[]> {
    const { data, error } = await getSupabase()
      .from('email_cases')
      .select('id, customer_name, customer_email, subject, booking_id, booking_start_at, booking_end_at, booking_status')
      .not('booking_start_at', 'is', null)
      .gte('booking_start_at', from.toISOString())
      .lte('booking_start_at', to.toISOString())
      .order('booking_start_at', { ascending: true })
      .limit(500);

    if (error) {
      log.warn({ error }, 'Failed to load ClearDesk bookings');
      return [];
    }

    return (data || []).map((row: any) => ({
      id: `cleardesk:${row.id}`,
      provider: 'cleardesk' as const,
      title: row.customer_name || row.customer_email || row.subject || `Case #${row.id}`,
      start: row.booking_start_at,
      end: row.booking_end_at || row.booking_start_at,
      href: `/dashboard/cases/${row.id}`,
      caseId: row.id,
      status: row.booking_status || 'booked',
    }));
  },
};
