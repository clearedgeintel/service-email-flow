import { z } from 'zod';

export const ClassificationSchema = z.object({
  intent: z.enum([
    'SALES_INQUIRY', 'REPAIR_REQUEST', 'EMERGENCY', 'BILLING',
    'GENERAL_QUESTION', 'JOB_APPLICANT', 'VENDOR', 'SPAM',
  ]),
  confidence: z.number().min(0).max(1),
  classification_reasons: z.array(z.string()).default(['Auto-classified']),
  emergency_keywords_found: z.array(z.string()).default([]),
  customer_name: z.string().nullable().default(null),
  customer_email: z.string().nullable().default(null),
  customer_phone: z.string().nullable().default(null),
  service_address: z.string().nullable().default(null),
  preferred_times: z.string().nullable().default(null),
  problem_summary: z.string().default(''),
  trade: z.enum(['electric', 'plumbing', 'both', 'unknown']).default('unknown'),
  urgency_level: z.enum(['EMERGENCY', 'TODAY', 'THIS_WEEK', 'ROUTINE']).default('ROUTINE'),
  requested_service_type: z.string().nullable().default(null),
  attachments_present: z.boolean().default(false),
  sentiment_score: z.number().min(-1).max(1).default(0),
  sentiment_label: z.enum(['frustrated', 'concerned', 'neutral', 'positive', 'grateful']).default('neutral'),
});

export type ClassificationResult = z.infer<typeof ClassificationSchema>;
