import { z } from 'zod';

// --- Cases ---

export const CaseUpdateSchema = z.object({
  status: z.enum([
    'RECEIVED', 'CLASSIFIED', 'RESPONDED_PENDING_BOOKING',
    'ESCALATED', 'NEEDS_REVIEW', 'NEEDS_MANUAL_CALL', 'CLOSED',
  ]).optional(),
  notes: z.string().max(5000).optional(),
  urgency_level: z.enum(['EMERGENCY', 'TODAY', 'THIS_WEEK', 'ROUTINE']).optional(),
  intent: z.enum([
    'SALES_INQUIRY', 'REPAIR_REQUEST', 'EMERGENCY', 'BILLING',
    'GENERAL_QUESTION', 'JOB_APPLICANT', 'VENDOR', 'SPAM',
  ]).optional(),
  trade: z.enum(['electric', 'plumbing', 'both', 'unknown']).optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field is required',
});

export const CaseNoteSchema = z.object({
  note: z.string().min(1, 'Note text is required').max(2000),
});

export const CaseQuerySchema = z.object({
  status: z.string().optional(),
  intent: z.string().optional(),
  urgency: z.string().optional(),
  trade: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  search: z.string().max(200).optional(),
  channel: z.enum(['email', 'voice', 'sms']).optional(),
  has_draft: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  sort: z.enum(['received_at', 'updated_at', 'urgency_level', 'status', 'intent']).default('received_at'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

// --- Pricing ---

export const PricingCreateSchema = z.object({
  trade: z.enum(['electric', 'plumbing']),
  service: z.string().min(1).max(200),
  keywords: z.union([
    z.array(z.string().min(1)),
    z.string().transform((s) => s.split(',').map((k) => k.trim()).filter(Boolean)),
  ]),
  price_min: z.coerce.number().min(0),
  price_max: z.coerce.number().min(0),
  unit: z.string().max(50).default('per job'),
}).refine((data) => data.price_max >= data.price_min, {
  message: 'price_max must be >= price_min',
});

export const PricingUpdateSchema = z.object({
  trade: z.enum(['electric', 'plumbing']).optional(),
  service: z.string().min(1).max(200).optional(),
  keywords: z.union([
    z.array(z.string().min(1)),
    z.string().transform((s) => s.split(',').map((k) => k.trim()).filter(Boolean)),
  ]).optional(),
  price_min: z.coerce.number().min(0).optional(),
  price_max: z.coerce.number().min(0).optional(),
  unit: z.string().max(50).optional(),
  active: z.boolean().optional(),
}).refine(
  (data) => Object.keys(data).length > 0,
  { message: 'At least one field is required' },
);

// --- Settings ---

export const SettingsUpdateSchema = z.record(
  z.string().min(1).max(100),
  z.unknown(),
).refine((data) => Object.keys(data).length > 0, {
  message: 'At least one setting is required',
});
