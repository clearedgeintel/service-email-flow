export enum EventType {
  RECEIVED = 'RECEIVED',
  CLASSIFIED = 'CLASSIFIED',
  ROUTED = 'ROUTED',
  REPLY_SENT = 'REPLY_SENT',
  TECH_NOTIFIED = 'TECH_NOTIFIED',
  FOLLOWUP_SENT = 'FOLLOWUP_SENT',
  ESCALATED = 'ESCALATED',
  CLOSED = 'CLOSED',
  NOTE_ADDED = 'NOTE_ADDED',
  MANUAL_ACTION = 'MANUAL_ACTION',
  STATUS_CHANGED = 'STATUS_CHANGED',
  ERROR = 'ERROR',
}

export interface CaseEvent {
  id: number;
  case_id: number;
  event_type: EventType;
  actor: string;
  summary: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}
