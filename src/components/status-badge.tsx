import { clsx } from 'clsx';

const STATUS_COLORS: Record<string, string> = {
  RECEIVED: 'bg-blue-100 text-blue-800',
  CLASSIFIED: 'bg-indigo-100 text-indigo-800',
  RESPONDED_PENDING_BOOKING: 'bg-yellow-100 text-yellow-800',
  ESCALATED: 'bg-red-100 text-red-800',
  NEEDS_REVIEW: 'bg-orange-100 text-orange-800',
  NEEDS_MANUAL_CALL: 'bg-purple-100 text-purple-800',
  CLOSED: 'bg-gray-100 text-gray-600',
};

const URGENCY_COLORS: Record<string, string> = {
  EMERGENCY: 'bg-red-100 text-red-800',
  TODAY: 'bg-orange-100 text-orange-800',
  THIS_WEEK: 'bg-yellow-100 text-yellow-800',
  ROUTINE: 'bg-green-100 text-green-800',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={clsx('px-2 py-0.5 rounded-full text-xs font-medium', STATUS_COLORS[status] || 'bg-gray-100 text-gray-600')}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

export function UrgencyBadge({ urgency }: { urgency: string }) {
  return (
    <span className={clsx('px-2 py-0.5 rounded-full text-xs font-medium', URGENCY_COLORS[urgency] || 'bg-gray-100 text-gray-600')}>
      {urgency}
    </span>
  );
}

export function IntentBadge({ intent }: { intent: string }) {
  const colors: Record<string, string> = {
    EMERGENCY: 'bg-red-100 text-red-800',
    REPAIR_REQUEST: 'bg-blue-100 text-blue-800',
    SALES_INQUIRY: 'bg-green-100 text-green-800',
    GENERAL_QUESTION: 'bg-teal-100 text-teal-800',
    BILLING: 'bg-purple-100 text-purple-800',
    VENDOR: 'bg-gray-100 text-gray-600',
    JOB_APPLICANT: 'bg-pink-100 text-pink-800',
    SPAM: 'bg-gray-200 text-gray-500',
  };

  return (
    <span className={clsx('px-2 py-0.5 rounded-full text-xs font-medium', colors[intent] || 'bg-gray-100 text-gray-600')}>
      {intent.replace(/_/g, ' ')}
    </span>
  );
}
