import crypto from 'crypto';
import { getSupabase } from '@/lib/supabase';
import { createChildLogger } from '@/lib/logger';
import { logCaseEvent } from './case-event.service';
import { EventType } from '@/types/events';

const log = createChildLogger('calcom');

export type CalcomEventType =
  | 'BOOKING_CREATED'
  | 'BOOKING_CANCELLED'
  | 'BOOKING_RESCHEDULED'
  | 'MEETING_ENDED'
  | 'BOOKING_REQUESTED'
  | 'BOOKING_REJECTED';

export interface CalcomWebhookPayload {
  triggerEvent: CalcomEventType;
  createdAt: string;
  payload?: Record<string, unknown>;
  // MEETING_STARTED/ENDED have flat payloads
  [key: string]: unknown;
}

/** Verify Cal.com webhook signature (HMAC-SHA256 of raw body) */
export function verifyCalcomSignature(rawBody: string, signature: string, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

interface BookingData {
  uid: string;
  startTime: string;
  endTime: string;
  attendeeEmail: string;
  cancellationReason?: string;
  bookingUrl?: string;
  /** ClearDesk case ID parsed from Cal.com metadata.cleardesk_case_id, if set */
  clearDeskCaseId?: number;
}

/** Extract normalized booking data from a Cal.com webhook payload */
function extractBookingData(webhook: CalcomWebhookPayload): BookingData | null {
  // BOOKING_* events wrap data in `payload`, MEETING_* events use flat structure
  const data = (webhook.payload || webhook) as Record<string, unknown>;

  const uid = data.uid as string | undefined;
  const startTime = data.startTime as string | undefined;
  const endTime = data.endTime as string | undefined;

  if (!uid || !startTime) return null;

  // Attendees is an array; take the first customer email
  const attendees = data.attendees as Array<{ email?: string }> | undefined;
  const attendeeEmail = attendees?.[0]?.email?.toLowerCase() || '';

  if (!attendeeEmail) return null;

  // Parse ClearDesk case ID out of Cal.com metadata if it was embedded in
  // the booking URL as metadata[cleardesk_case_id]=<id>. This is the
  // authoritative case-match signal when present.
  const metadata = data.metadata as Record<string, unknown> | undefined;
  const rawCaseId = metadata?.cleardesk_case_id;
  const clearDeskCaseId = typeof rawCaseId === 'number'
    ? rawCaseId
    : typeof rawCaseId === 'string'
      ? parseInt(rawCaseId, 10)
      : undefined;

  return {
    uid,
    startTime,
    endTime: endTime || startTime,
    attendeeEmail,
    cancellationReason: data.cancellationReason as string | undefined,
    bookingUrl: metadata?.videoCallUrl as string | undefined,
    clearDeskCaseId: clearDeskCaseId && !isNaN(clearDeskCaseId) ? clearDeskCaseId : undefined,
  };
}

/** Find the most recent open case for a customer email */
async function findCaseForBooking(email: string): Promise<number | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('email_cases')
    .select('id')
    .or(`customer_email.eq.${email},from_email.eq.${email}`)
    .not('status', 'in', '(CLOSED)')
    .order('received_at', { ascending: false })
    .limit(1);

  if (error || !data || data.length === 0) {
    return null;
  }
  return (data[0] as { id: number }).id;
}

/** Process a Cal.com webhook event and update the matching case */
export async function processCalcomWebhook(webhook: CalcomWebhookPayload): Promise<{
  handled: boolean;
  caseId: number | null;
  reason?: string;
}> {
  const booking = extractBookingData(webhook);
  if (!booking) {
    return { handled: false, caseId: null, reason: 'No booking data in payload' };
  }

  const supabase = getSupabase();

  // Case-match priority:
  // 1. metadata.cleardesk_case_id embedded in the booking URL — authoritative
  // 2. existing case where booking_id matches (handles reschedule / cancel)
  // 3. most recent open case for the attendee email — legacy fallback
  //
  // The email fallback is unreliable when multiple open cases share a
  // customer email (common in testing, and for repeat customers in prod),
  // so metadata-based matching is strongly preferred. Any URL we generate
  // after PR #19 carries the metadata.
  let caseId: number | null = null;
  let matchedBy: 'metadata' | 'booking_id' | 'email' | 'none' = 'none';

  if (booking.clearDeskCaseId) {
    const { data: metaCase } = await supabase
      .from('email_cases')
      .select('id')
      .eq('id', booking.clearDeskCaseId)
      .maybeSingle();
    if (metaCase) {
      caseId = (metaCase as { id: number }).id;
      matchedBy = 'metadata';
    } else {
      log.warn(
        { metadata_case_id: booking.clearDeskCaseId, uid: booking.uid },
        'Booking metadata pointed at a case that does not exist; falling back to email match',
      );
    }
  }

  if (!caseId) {
    const { data: existing } = await supabase
      .from('email_cases')
      .select('id')
      .eq('booking_id', booking.uid)
      .maybeSingle();
    if (existing) {
      caseId = (existing as { id: number }).id;
      matchedBy = 'booking_id';
    }
  }

  if (!caseId) {
    caseId = await findCaseForBooking(booking.attendeeEmail);
    if (caseId) {
      matchedBy = 'email';
      log.info(
        { caseId, email: booking.attendeeEmail, uid: booking.uid },
        'Matched booking by email only (legacy) — consider re-sending replies for cleaner metadata attribution',
      );
    }
  }

  if (!caseId) {
    log.warn({ email: booking.attendeeEmail, uid: booking.uid }, 'No matching case for booking');
    return { handled: false, caseId: null, reason: 'No matching case found' };
  }

  log.info({ caseId, matchedBy, uid: booking.uid }, 'Booking matched to case');

  // Determine new state based on event type
  const updates: Record<string, unknown> = {
    booking_id: booking.uid,
    booking_start_at: booking.startTime,
    booking_end_at: booking.endTime,
  };

  let eventSummary: string;
  let newStatus: string | undefined;

  switch (webhook.triggerEvent) {
    case 'BOOKING_CREATED':
      updates.booking_status = 'booked';
      newStatus = 'RESPONDED_PENDING_BOOKING';
      eventSummary = `Appointment booked for ${new Date(booking.startTime).toLocaleString()}`;
      break;

    case 'BOOKING_RESCHEDULED':
      updates.booking_status = 'booked';
      eventSummary = `Appointment rescheduled to ${new Date(booking.startTime).toLocaleString()}`;
      break;

    case 'BOOKING_CANCELLED':
      updates.booking_status = 'cancelled';
      updates.booking_cancelled_reason = booking.cancellationReason || null;
      newStatus = 'NEEDS_REVIEW';
      eventSummary = `Appointment cancelled${booking.cancellationReason ? ': ' + booking.cancellationReason : ''}`;
      break;

    case 'MEETING_ENDED':
      updates.booking_status = 'completed';
      newStatus = 'CLOSED';
      eventSummary = 'Appointment completed';
      break;

    default:
      return { handled: false, caseId, reason: `Unhandled event type: ${webhook.triggerEvent}` };
  }

  if (newStatus) {
    updates.status = newStatus;
  }

  const { error: updateError } = await supabase
    .from('email_cases')
    .update(updates)
    .eq('id', caseId);

  if (updateError) {
    log.error({ error: updateError, caseId }, 'Failed to update case with booking');
    throw new Error(`Failed to update case #${caseId}: ${updateError.message}`);
  }

  await logCaseEvent({
    caseId,
    eventType: EventType.STATUS_CHANGED,
    actor: 'calcom',
    summary: eventSummary,
    metadata: {
      trigger: webhook.triggerEvent,
      booking_id: booking.uid,
      start_time: booking.startTime,
      end_time: booking.endTime,
    },
  });

  // Emit outbound webhook events so integrations (Zapier, n8n, CRMs) can react
  const { emitWebhookEvent } = await import('./webhook.service');
  if (webhook.triggerEvent === 'BOOKING_CREATED' || webhook.triggerEvent === 'BOOKING_RESCHEDULED') {
    emitWebhookEvent('case.booked', caseId, {
      booking_id: booking.uid,
      start_time: booking.startTime,
      end_time: booking.endTime,
      attendee_email: booking.attendeeEmail,
      is_reschedule: webhook.triggerEvent === 'BOOKING_RESCHEDULED',
    });
  }
  if (webhook.triggerEvent === 'MEETING_ENDED') {
    emitWebhookEvent('case.closed', caseId, {
      closed_by: 'calcom_meeting_ended',
      booking_id: booking.uid,
    });
  }

  log.info(
    { caseId, event: webhook.triggerEvent, bookingId: booking.uid },
    'Cal.com webhook processed',
  );

  return { handled: true, caseId };
}
