export interface PricingItem {
  id: number;
  trade: string;
  service: string;
  keywords: string[];
  price_min: number;
  price_max: number;
  unit: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface RoutingDecision {
  newStatus: string;
  requiresCustomerReply: boolean;
  requiresTechNotify: boolean;
  gmailLabels: string[];
  routeReason: string;
}

export interface NormalizedEmail {
  gmail_message_id: string;
  gmail_thread_id: string;
  from_email: string;
  from_name: string | null;
  subject: string;
  body_raw: string;
  body_cleaned: string;
  snippet: string;
  has_attachments: boolean;
  received_at: string;
}
