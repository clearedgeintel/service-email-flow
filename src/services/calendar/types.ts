/**
 * Calendar provider abstraction — the UI and API routes stay agnostic to
 * whether events/slots come from Cal.com, Calendly, or Google Calendar.
 * Adding a new provider means implementing this interface and registering
 * it with `getCalendarProviders()`; everything else stays the same.
 */

export type ProviderId = 'cleardesk' | 'calcom' | 'calendly' | 'google';

export interface CalendarEvent {
  /** Stable ID unique within the provider */
  id: string;
  provider: ProviderId;
  title: string;
  start: string;              // ISO string
  end: string;                // ISO string
  /** Optional deep-link — case URL for ClearDesk, provider URL for external */
  href?: string;
  /** ClearDesk case ID when this event represents a ClearDesk booking */
  caseId?: number;
  /** Status: booked | cancelled | completed | tentative | busy */
  status?: string;
  /** Free-form metadata (attendee email, notes, etc.) */
  metadata?: Record<string, unknown>;
}

export interface FreeSlot {
  provider: ProviderId;
  start: string;              // ISO string
  end: string;                // ISO string
  /** Pre-filled provider URL to book this specific slot, when available */
  bookingUrl?: string;
  /** Event type name, for providers that expose multiple */
  eventTypeLabel?: string;
}

export interface CalendarProvider {
  id: ProviderId;
  label: string;

  /** True when the provider has credentials set and is toggled on in settings */
  isConfigured(): Promise<boolean>;

  /** Busy blocks: booked appointments, personal events, etc. */
  listEvents(from: Date, to: Date): Promise<CalendarEvent[]>;

  /**
   * Open time slots the admin could offer to customers. Optional because
   * read-only providers (Google personal calendar) don't expose booking.
   */
  listFreeSlots?(from: Date, to: Date, eventTypeId?: string): Promise<FreeSlot[]>;
}
