import { getSupabase } from '@/lib/supabase';
import { getConfig } from '@/lib/config';
import { createChildLogger } from '@/lib/logger';
import { logCaseEvent } from './case-event.service';
import { EventType, RoutingDecision } from '@/types';

const log = createChildLogger('router');

export async function routeCase(caseId: number): Promise<RoutingDecision> {
  const supabase = getSupabase();

  const { data: row, error: fetchError } = await supabase
    .from('email_cases')
    .select('*')
    .eq('id', caseId)
    .single();

  if (fetchError || !row) {
    throw new Error(`Case #${caseId} not found: ${fetchError?.message}`);
  }

  const confidenceThreshold = await getConfig<number>('confidence_threshold', 0.70);

  const decision: RoutingDecision = {
    newStatus: 'NEEDS_REVIEW',
    requiresCustomerReply: false,
    requiresTechNotify: false,
    gmailLabels: ['n8n/review'],
    routeReason: '',
  };

  // Low-confidence override
  const confidence = parseFloat(row.confidence) || 0;
  if (confidence < confidenceThreshold && row.intent !== 'SPAM') {
    decision.newStatus = 'NEEDS_REVIEW';
    decision.gmailLabels = ['n8n/review'];
    decision.routeReason = `Low confidence (${confidence.toFixed(2)}) — held for manual review`;
  } else {
    // Route by intent
    switch (row.intent) {
      case 'EMERGENCY':
        decision.newStatus = 'ESCALATED';
        decision.requiresTechNotify = true;
        decision.requiresCustomerReply = true;
        decision.gmailLabels = ['n8n/escalated'];
        decision.routeReason = `EMERGENCY — keywords: ${(row.emergency_keywords_found || row.classification_reasons || []).join(', ')}`;
        break;

      case 'REPAIR_REQUEST':
        decision.newStatus = 'RESPONDED_PENDING_BOOKING';
        decision.requiresTechNotify = true;
        decision.requiresCustomerReply = true;
        decision.gmailLabels = ['n8n/responded'];
        decision.routeReason = `Repair request — urgency: ${row.urgency_level}, trade: ${row.trade}`;
        break;

      case 'SALES_INQUIRY':
      case 'GENERAL_QUESTION':
        decision.newStatus = 'RESPONDED_PENDING_BOOKING';
        decision.requiresCustomerReply = true;
        decision.gmailLabels = ['n8n/responded'];
        decision.routeReason = `${row.intent} — offering estimate booking`;
        break;

      case 'BILLING':
      case 'VENDOR':
      case 'JOB_APPLICANT':
        decision.newStatus = 'NEEDS_REVIEW';
        decision.gmailLabels = ['n8n/review'];
        decision.routeReason = `Admin route — intent: ${row.intent}, forwarded to review queue`;
        break;

      case 'SPAM':
      case 'IRRELEVANT':
        decision.newStatus = 'CLOSED';
        decision.gmailLabels = ['n8n/closed'];
        decision.routeReason = 'Spam/irrelevant — auto-closed';
        break;

      default:
        decision.newStatus = 'NEEDS_REVIEW';
        decision.gmailLabels = ['n8n/review'];
        decision.routeReason = `Fallback — unrecognized intent: ${row.intent}`;
        break;
    }
  }

  // Update case in DB
  const { error: updateError } = await supabase
    .from('email_cases')
    .update({
      status: decision.newStatus,
      requires_tech_notify: decision.requiresTechNotify,
      requires_customer_reply: decision.requiresCustomerReply,
      notes: (row.notes || '') + ' | ' + decision.routeReason,
    })
    .eq('id', caseId);

  if (updateError) {
    throw new Error(`Failed to update case #${caseId}: ${updateError.message}`);
  }

  // Label Gmail message
  if (row.gmail_message_id) {
    await labelGmailMessage(row.gmail_message_id, decision.gmailLabels);
  }

  // Log event
  await logCaseEvent({
    caseId,
    eventType: EventType.ROUTED,
    summary: `Routed to ${decision.newStatus} — ${decision.routeReason}`,
    metadata: {
      new_status: decision.newStatus,
      requires_customer_reply: decision.requiresCustomerReply,
      requires_tech_notify: decision.requiresTechNotify,
      gmail_labels: decision.gmailLabels,
    },
  });

  log.info(
    {
      caseId,
      intent: row.intent,
      newStatus: decision.newStatus,
      techNotify: decision.requiresTechNotify,
      customerReply: decision.requiresCustomerReply,
    },
    'Case routed',
  );

  return decision;
}

async function labelGmailMessage(messageId: string, labels: string[]): Promise<void> {
  try {
    const { getGmail } = await import('@/lib/gmail');
    const gmail = getGmail();
    await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: { addLabelIds: labels },
    });
  } catch {
    // Label may not exist — not critical
  }
}
