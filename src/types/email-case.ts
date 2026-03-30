export enum CaseStatus {
  RECEIVED = 'RECEIVED',
  CLASSIFIED = 'CLASSIFIED',
  RESPONDED_PENDING_BOOKING = 'RESPONDED_PENDING_BOOKING',
  ESCALATED = 'ESCALATED',
  NEEDS_REVIEW = 'NEEDS_REVIEW',
  NEEDS_MANUAL_CALL = 'NEEDS_MANUAL_CALL',
  CLOSED = 'CLOSED',
}

export enum Intent {
  SALES_INQUIRY = 'SALES_INQUIRY',
  REPAIR_REQUEST = 'REPAIR_REQUEST',
  EMERGENCY = 'EMERGENCY',
  BILLING = 'BILLING',
  GENERAL_QUESTION = 'GENERAL_QUESTION',
  JOB_APPLICANT = 'JOB_APPLICANT',
  VENDOR = 'VENDOR',
  SPAM = 'SPAM',
}

export enum UrgencyLevel {
  EMERGENCY = 'EMERGENCY',
  TODAY = 'TODAY',
  THIS_WEEK = 'THIS_WEEK',
  ROUTINE = 'ROUTINE',
}

export enum Trade {
  ELECTRIC = 'electric',
  PLUMBING = 'plumbing',
  BOTH = 'both',
  UNKNOWN = 'unknown',
}

export interface EmailCase {
  id: number;
  gmail_message_id: string;
  gmail_thread_id: string | null;
  from_email: string;
  from_name: string | null;
  subject: string | null;
  body_raw: string | null;
  body_cleaned: string | null;
  snippet: string | null;
  has_attachments: boolean;
  received_at: string;

  // Classification
  status: CaseStatus;
  intent: Intent | null;
  confidence: number | null;
  classification_reasons: string[] | null;
  emergency_keywords_found: string[] | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  service_address: string | null;
  preferred_times: string | null;
  problem_summary: string | null;
  trade: Trade | null;
  urgency_level: UrgencyLevel | null;
  requested_service: string | null;
  attachments_present: boolean;

  // Routing
  requires_tech_notify: boolean;
  requires_customer_reply: boolean;

  // Reply tracking
  customer_reply_sent: boolean;
  customer_reply_at: string | null;

  // Tech notification
  tech_notified: boolean;
  tech_notified_at: string | null;

  // Follow-up
  followup_count: number;
  last_followup_at: string | null;

  // Metadata
  gmail_labels: string[] | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}
