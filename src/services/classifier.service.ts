import { getAnthropic, getModel } from '@/lib/anthropic';
import { getSupabase } from '@/lib/supabase';
import { createChildLogger } from '@/lib/logger';
import { logCaseEvent } from './case-event.service';
import { ClassificationSchema, ClassificationResult } from '@/types/classification';
import { EventType } from '@/types/events';

const log = createChildLogger('classifier');

const SYSTEM_PROMPT = `You are an email classifier for a local electrician and plumber service business.

Your job is to analyze incoming customer emails and extract structured data.

RULES:
1. Return ONLY valid JSON. No markdown, no code fences, no explanation text.
2. Be conservative with EMERGENCY classification. Only use EMERGENCY if there is clear evidence of:
   - Gas smell or gas leak
   - Active flooding or sewage backup
   - No heat when outside temps are dangerously cold (below freezing)
   - Sparking electrical panel or exposed live wires
   - Carbon monoxide alarm sounding
   - Active water leak causing structural damage RIGHT NOW
3. Confidence must honestly reflect certainty (0.0 to 1.0).
4. Extract every field you can find. Use null for fields not present.
5. problem_summary should be 1-2 sentences MAX.
6. For trade: use "electric" for electrical work, "plumbing" for plumbing, "both" if mixed, "unknown" if unclear.
7. For urgency_level:
   - EMERGENCY = immediate danger to life/property
   - TODAY = customer explicitly needs same-day service
   - THIS_WEEK = customer wants it soon but not urgent
   - ROUTINE = general inquiry, no rush indicated

8. For sentiment_score: rate customer tone from -1.0 (angry/frustrated) to 1.0 (happy/grateful). 0.0 = neutral.
9. For sentiment_label: use exactly one of: "frustrated", "concerned", "neutral", "positive", "grateful"

JSON SCHEMA — respond with EXACTLY this structure:
{
  "intent": "SALES_INQUIRY|REPAIR_REQUEST|EMERGENCY|BILLING|GENERAL_QUESTION|JOB_APPLICANT|VENDOR|SPAM",
  "confidence": 0.0,
  "classification_reasons": ["reason1", "reason2", "reason3"],
  "emergency_keywords_found": [],
  "customer_name": "string or null",
  "customer_email": "string or null",
  "customer_phone": "string or null",
  "service_address": "string or null",
  "preferred_times": "string or null",
  "problem_summary": "1-2 sentence summary",
  "trade": "electric|plumbing|both|unknown",
  "urgency_level": "EMERGENCY|TODAY|THIS_WEEK|ROUTINE",
  "requested_service_type": "string or null",
  "attachments_present": false,
  "sentiment_score": 0.0,
  "sentiment_label": "neutral"
}`;

export async function classifyCase(caseId: number): Promise<ClassificationResult> {
  const supabase = getSupabase();

  // Fetch case data
  const { data: row, error: fetchError } = await supabase
    .from('email_cases')
    .select('*')
    .eq('id', caseId)
    .single();

  if (fetchError || !row) {
    throw new Error(`Case #${caseId} not found: ${fetchError?.message}`);
  }

  const userPrompt = `Classify this incoming email:

FROM: ${row.from_name || 'Unknown'} <${row.from_email || 'unknown'}>
SUBJECT: ${row.subject || '(no subject)'}

EMAIL BODY:
${row.body_cleaned || row.body_raw || row.snippet || '(empty)'}

HAS ATTACHMENTS: ${row.has_attachments || false}
SENDER EMAIL: ${row.from_email || 'unknown'}

Return ONLY the JSON object. No other text whatsoever.`;

  // Call Anthropic
  const anthropic = getAnthropic();
  const response = await anthropic.messages.create({
    model: getModel(),
    max_tokens: 1000,
    system: SYSTEM_PROMPT,
    messages: [
      { role: 'user', content: userPrompt },
    ],
  });

  const rawContent = response.content[0]?.type === 'text' ? response.content[0].text : '{}';

  // Parse and validate with zod
  let parsed: ClassificationResult;
  let validationErrors: string[] = [];

  try {
    const cleanContent = rawContent
      .replace(/```json\s*/g, '')
      .replace(/```\s*/g, '')
      .trim();

    const raw = JSON.parse(cleanContent);
    const result = ClassificationSchema.safeParse(raw);

    if (result.success) {
      parsed = result.data;
    } else {
      // Zod coerced what it could — extract issues
      validationErrors = result.error.issues.map(
        (i) => `${i.path.join('.')}: ${i.message}`,
      );
      // Try again with defaults forced
      parsed = ClassificationSchema.parse({
        ...raw,
        intent: raw.intent || 'GENERAL_QUESTION',
        confidence: typeof raw.confidence === 'number' ? raw.confidence : 0.5,
        urgency_level: raw.urgency_level || 'ROUTINE',
        trade: raw.trade || 'unknown',
      });
      // Cap confidence on validation errors
      parsed.confidence = Math.min(parsed.confidence, 0.6);
    }
  } catch (e) {
    log.error({ caseId, rawContent, err: e }, 'Failed to parse LLM response');
    // Return a safe fallback
    parsed = {
      intent: 'GENERAL_QUESTION',
      confidence: 0.3,
      classification_reasons: ['LLM response parse failure'],
      emergency_keywords_found: [],
      customer_name: null,
      customer_email: row.from_email,
      customer_phone: null,
      service_address: null,
      preferred_times: null,
      problem_summary: 'Classification failed — needs manual review',
      trade: 'unknown',
      urgency_level: 'ROUTINE',
      requested_service_type: null,
      attachments_present: row.has_attachments || false,
    };
    validationErrors = [`JSON parse error: ${e instanceof Error ? e.message : String(e)}`];
  }

  // Determine if low confidence → needs review
  const needsReview = parsed.confidence < 0.70;
  const newStatus = needsReview ? 'NEEDS_REVIEW' : 'CLASSIFIED';

  // Update case in DB
  const { error: updateError } = await supabase
    .from('email_cases')
    .update({
      intent: parsed.intent,
      confidence: parsed.confidence,
      classification_reasons: parsed.classification_reasons,
      emergency_keywords_found: parsed.emergency_keywords_found,
      customer_name: parsed.customer_name,
      customer_email: parsed.customer_email || row.from_email,
      customer_phone: parsed.customer_phone,
      service_address: parsed.service_address,
      preferred_times: parsed.preferred_times,
      problem_summary: parsed.problem_summary,
      trade: parsed.trade,
      urgency_level: parsed.urgency_level,
      requested_service: parsed.requested_service_type,
      attachments_present: parsed.attachments_present,
      sentiment_score: parsed.sentiment_score,
      sentiment_label: parsed.sentiment_label,
      status: newStatus,
    })
    .eq('id', caseId);

  if (updateError) {
    throw new Error(`Failed to update case #${caseId}: ${updateError.message}`);
  }

  // Sync Gmail label to match new status
  const { syncMessageLabel } = await import('@/lib/gmail-labels');
  await syncMessageLabel(row.gmail_message_id, newStatus);

  // Log event
  await logCaseEvent({
    caseId,
    eventType: EventType.CLASSIFIED,
    summary: `Classified as ${parsed.intent} (confidence: ${parsed.confidence.toFixed(2)}) — ${newStatus}`,
    metadata: {
      intent: parsed.intent,
      confidence: parsed.confidence,
      urgency_level: parsed.urgency_level,
      trade: parsed.trade,
      needs_review: needsReview,
      validation_errors: validationErrors.length > 0 ? validationErrors : undefined,
    },
  });

  log.info(
    {
      caseId,
      intent: parsed.intent,
      confidence: parsed.confidence,
      urgency: parsed.urgency_level,
      status: newStatus,
    },
    'Case classified',
  );

  return parsed;
}
