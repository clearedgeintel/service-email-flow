import { clsx } from 'clsx';

// Soft, pill-style badges — subdued backgrounds + matching border, normal weight.
// Emergency keeps a slightly stronger accent since it matters.
const BASE = 'inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-normal border';

const STATUS_COLORS: Record<string, string> = {
  RECEIVED:                  'bg-blue-50 text-blue-700 border-blue-100 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-800/40',
  CLASSIFIED:                'bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-800/40 dark:text-slate-300 dark:border-slate-700',
  RESPONDED_PENDING_BOOKING: 'bg-amber-50 text-amber-700 border-amber-100 dark:bg-amber-900/20 dark:text-amber-200 dark:border-amber-800/40',
  ESCALATED:                 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-800/40',
  NEEDS_REVIEW:              'bg-orange-50 text-orange-700 border-orange-100 dark:bg-orange-900/20 dark:text-orange-300 dark:border-orange-800/40',
  NEEDS_MANUAL_CALL:         'bg-violet-50 text-violet-700 border-violet-100 dark:bg-violet-900/20 dark:text-violet-300 dark:border-violet-800/40',
  CLOSED:                    'bg-gray-50 text-gray-500 border-gray-200 dark:bg-gray-800/40 dark:text-gray-400 dark:border-gray-700',
};

const URGENCY_COLORS: Record<string, string> = {
  EMERGENCY:  'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-800/40',
  TODAY:      'bg-orange-50 text-orange-700 border-orange-100 dark:bg-orange-900/20 dark:text-orange-300 dark:border-orange-800/40',
  THIS_WEEK:  'bg-amber-50 text-amber-700 border-amber-100 dark:bg-amber-900/20 dark:text-amber-200 dark:border-amber-800/40',
  ROUTINE:    'bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-800/40',
};

const INTENT_COLORS: Record<string, string> = {
  EMERGENCY:        'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-800/40',
  REPAIR_REQUEST:   'bg-sky-50 text-sky-700 border-sky-100 dark:bg-sky-900/20 dark:text-sky-300 dark:border-sky-800/40',
  SALES_INQUIRY:    'bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-800/40',
  GENERAL_QUESTION: 'bg-teal-50 text-teal-700 border-teal-100 dark:bg-teal-900/20 dark:text-teal-300 dark:border-teal-800/40',
  BILLING:          'bg-violet-50 text-violet-700 border-violet-100 dark:bg-violet-900/20 dark:text-violet-300 dark:border-violet-800/40',
  VENDOR:           'bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-800/40 dark:text-slate-300 dark:border-slate-700',
  JOB_APPLICANT:    'bg-pink-50 text-pink-700 border-pink-100 dark:bg-pink-900/20 dark:text-pink-300 dark:border-pink-800/40',
  SPAM:             'bg-gray-50 text-gray-400 border-gray-200 dark:bg-gray-800/40 dark:text-gray-500 dark:border-gray-700',
};

const DEFAULT_COLOR = 'bg-gray-50 text-gray-500 border-gray-200 dark:bg-gray-800/40 dark:text-gray-400 dark:border-gray-700';

function formatLabel(s: string): string {
  // Turn CONSTANT_CASE into "Title Case"
  return s
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={clsx(BASE, STATUS_COLORS[status] || DEFAULT_COLOR)}>
      {formatLabel(status)}
    </span>
  );
}

export function UrgencyBadge({ urgency }: { urgency: string }) {
  return (
    <span className={clsx(BASE, URGENCY_COLORS[urgency] || DEFAULT_COLOR)}>
      {formatLabel(urgency)}
    </span>
  );
}

export function IntentBadge({ intent }: { intent: string }) {
  return (
    <span className={clsx(BASE, INTENT_COLORS[intent] || DEFAULT_COLOR)}>
      {formatLabel(intent)}
    </span>
  );
}
