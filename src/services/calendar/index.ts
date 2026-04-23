import { CalendarEvent, CalendarProvider, FreeSlot, ProviderId } from './types';
import { clearDeskProvider } from './cleardesk.provider';
import { calComProvider } from './calcom.provider';
import { googleCalendarProvider } from './google.provider';

/** All known providers. Additional ones (e.g. Calendly) get added here. */
const ALL_PROVIDERS: CalendarProvider[] = [
  clearDeskProvider,
  calComProvider,
  googleCalendarProvider,
];

/** Providers whose credentials are present and which are enabled. */
export async function getActiveProviders(): Promise<CalendarProvider[]> {
  const flags = await Promise.all(ALL_PROVIDERS.map((p) => p.isConfigured()));
  return ALL_PROVIDERS.filter((_, i) => flags[i]);
}

/** Fan out listEvents() across every active provider in parallel. */
export async function listAllEvents(from: Date, to: Date): Promise<CalendarEvent[]> {
  const providers = await getActiveProviders();
  const results = await Promise.all(providers.map((p) => p.listEvents(from, to)));
  return results.flat();
}

/** Fan out listFreeSlots() across providers that support booking. */
export async function listAllFreeSlots(from: Date, to: Date): Promise<FreeSlot[]> {
  const providers = await getActiveProviders();
  const results = await Promise.all(
    providers.map((p) => (p.listFreeSlots ? p.listFreeSlots(from, to) : Promise.resolve([]))),
  );
  return results.flat();
}

export type { CalendarEvent, CalendarProvider, FreeSlot, ProviderId };
