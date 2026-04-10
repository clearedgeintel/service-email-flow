'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { StatusBadge, UrgencyBadge, IntentBadge } from '@/components/status-badge';
import {
  ArrowLeft, RefreshCw, Send, AlertTriangle, X, MessageSquare, Clock,
  User, Mail, Phone, MapPin, FileText, Calendar, CheckCircle2,
} from 'lucide-react';

interface CaseDetail {
  id: number;
  gmail_message_id: string;
  gmail_thread_id: string | null;
  from_email: string;
  from_name: string | null;
  subject: string | null;
  body_cleaned: string | null;
  status: string;
  intent: string | null;
  confidence: number | null;
  urgency_level: string | null;
  trade: string | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  service_address: string | null;
  preferred_times: string | null;
  problem_summary: string | null;
  requested_service: string | null;
  classification_reasons: string[] | null;
  customer_reply_sent: boolean;
  customer_reply_at: string | null;
  tech_notified: boolean;
  tech_notified_at: string | null;
  followup_count: number;
  last_followup_at: string | null;
  notes: string | null;
  received_at: string;
  updated_at: string;
  booking_id: string | null;
  booking_status: string | null;
  booking_start_at: string | null;
  booking_end_at: string | null;
  booking_cancelled_reason: string | null;
}

interface TimelineEvent {
  id: number;
  event_type: string;
  actor: string;
  summary: string | null;
  created_at: string;
}

export default function CaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [caseData, setCaseData] = useState<CaseDetail | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState('');
  const [noteText, setNoteText] = useState('');

  const fetchCase = async () => {
    try {
      const res = await fetch(`/api/cases/${id}`);
      if (res.status === 401) { router.push('/login'); return; }
      if (res.status === 404) { router.push('/dashboard'); return; }
      const data = await res.json();
      setCaseData(data.case);
      setTimeline(data.timeline || []);
    } catch { /* */ } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchCase(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const runAction = async (action: string, body?: object) => {
    setActionLoading(action);
    try {
      const res = await fetch(`/api/cases/${id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.ok) {
        await fetchCase();
      }
    } finally {
      setActionLoading('');
    }
  };

  const addNote = async () => {
    if (!noteText.trim()) return;
    await runAction('add-note', { note: noteText });
    setNoteText('');
  };

  if (loading) {
    return <div className="p-6 text-gray-400">Loading case...</div>;
  }

  if (!caseData) {
    return <div className="p-6 text-gray-400">Case not found</div>;
  }

  const c = caseData;

  return (
    <div className="p-6 max-w-6xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Link href="/dashboard" className="p-2 rounded-lg hover:bg-gray-100">
          <ArrowLeft className="w-5 h-5 text-gray-500" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">Case #{c.id}</h1>
            <StatusBadge status={c.status} />
            {c.urgency_level && <UrgencyBadge urgency={c.urgency_level} />}
            {c.intent && <IntentBadge intent={c.intent} />}
          </div>
          <p className="text-sm text-gray-500 mt-1">{c.subject || '(no subject)'}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Customer Info */}
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h2 className="font-semibold text-gray-900 mb-3">Customer Information</h2>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <InfoRow icon={User} label="Name" value={c.customer_name} />
              <InfoRow icon={Mail} label="Email" value={c.customer_email || c.from_email} />
              <InfoRow icon={Phone} label="Phone" value={c.customer_phone} />
              <InfoRow icon={MapPin} label="Address" value={c.service_address} />
              <InfoRow icon={Calendar} label="Preferred Times" value={c.preferred_times} />
              <InfoRow icon={FileText} label="Trade" value={c.trade} />
            </div>
          </div>

          {/* Booking (if present) */}
          {c.booking_id && (
            <div className={`border rounded-xl p-5 ${
              c.booking_status === 'cancelled'
                ? 'bg-red-50 border-red-200'
                : c.booking_status === 'completed'
                  ? 'bg-gray-50 border-gray-200'
                  : 'bg-green-50 border-green-200'
            }`}>
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle2 className={`w-5 h-5 ${
                  c.booking_status === 'cancelled' ? 'text-red-600' :
                  c.booking_status === 'completed' ? 'text-gray-600' : 'text-green-600'
                }`} />
                <h2 className="font-semibold text-gray-900">
                  Appointment {c.booking_status === 'booked' ? 'Booked' : c.booking_status === 'cancelled' ? 'Cancelled' : c.booking_status === 'completed' ? 'Completed' : 'Scheduled'}
                </h2>
              </div>
              <dl className="space-y-1.5 text-sm">
                {c.booking_start_at && (
                  <div className="flex justify-between">
                    <dt className="text-gray-600">Start</dt>
                    <dd className="text-gray-900 font-medium">{new Date(c.booking_start_at).toLocaleString()}</dd>
                  </div>
                )}
                {c.booking_end_at && (
                  <div className="flex justify-between">
                    <dt className="text-gray-600">End</dt>
                    <dd className="text-gray-900 font-medium">{new Date(c.booking_end_at).toLocaleString()}</dd>
                  </div>
                )}
                <div className="flex justify-between">
                  <dt className="text-gray-600">Booking ID</dt>
                  <dd className="text-gray-500 font-mono text-xs">{c.booking_id}</dd>
                </div>
                {c.booking_cancelled_reason && (
                  <div className="flex justify-between">
                    <dt className="text-gray-600">Reason</dt>
                    <dd className="text-gray-800">{c.booking_cancelled_reason}</dd>
                  </div>
                )}
              </dl>
            </div>
          )}

          {/* Problem Summary */}
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h2 className="font-semibold text-gray-900 mb-3">Problem Summary</h2>
            <p className="text-sm text-gray-700">{c.problem_summary || 'No summary available'}</p>
            {c.requested_service && (
              <p className="text-sm text-gray-500 mt-2">Requested: {c.requested_service}</p>
            )}
            {c.classification_reasons && c.classification_reasons.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1">
                {c.classification_reasons.map((r, i) => (
                  <span key={i} className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">{r}</span>
                ))}
              </div>
            )}
          </div>

          {/* Email Body */}
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h2 className="font-semibold text-gray-900 mb-3">Email Body</h2>
            <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans max-h-64 overflow-y-auto">
              {c.body_cleaned || '(empty)'}
            </pre>
          </div>

          {/* Notes */}
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h2 className="font-semibold text-gray-900 mb-3">Notes</h2>
            {c.notes ? (
              <p className="text-sm text-gray-700 whitespace-pre-wrap mb-3">{c.notes}</p>
            ) : (
              <p className="text-sm text-gray-400 mb-3">No notes yet</p>
            )}
            <div className="flex gap-2">
              <input
                type="text"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addNote()}
                placeholder="Add a note..."
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
              <button
                onClick={addNote}
                disabled={!noteText.trim() || actionLoading === 'add-note'}
                className="px-4 py-2 bg-gray-800 text-white rounded-lg text-sm hover:bg-gray-900 disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </div>

          {/* Timeline */}
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h2 className="font-semibold text-gray-900 mb-3">Timeline</h2>
            {timeline.length === 0 ? (
              <p className="text-sm text-gray-400">No events</p>
            ) : (
              <div className="space-y-3">
                {timeline.map((evt) => (
                  <div key={evt.id} className="flex gap-3 text-sm">
                    <div className="w-2 h-2 rounded-full bg-blue-400 mt-1.5 shrink-0" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-800">{evt.event_type.replace(/_/g, ' ')}</span>
                        <span className="text-xs text-gray-400">
                          {new Date(evt.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {evt.actor !== 'system' && (
                          <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">{evt.actor}</span>
                        )}
                      </div>
                      {evt.summary && <p className="text-gray-600 mt-0.5">{evt.summary}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar — Actions + Meta */}
        <div className="space-y-6">
          {/* Actions */}
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h2 className="font-semibold text-gray-900 mb-3">Actions</h2>
            <div className="space-y-2">
              <ActionButton
                icon={RefreshCw}
                label="Reclassify"
                onClick={() => runAction('reclassify')}
                loading={actionLoading === 'reclassify'}
              />
              <ActionButton
                icon={Send}
                label="Resend Reply"
                onClick={() => runAction('resend-reply')}
                loading={actionLoading === 'resend-reply'}
              />
              <ActionButton
                icon={AlertTriangle}
                label="Escalate"
                onClick={() => runAction('escalate')}
                loading={actionLoading === 'escalate'}
                variant="danger"
              />
              <ActionButton
                icon={Clock}
                label="Trigger Follow-up"
                onClick={() => runAction('trigger-followup')}
                loading={actionLoading === 'trigger-followup'}
              />
              <ActionButton
                icon={X}
                label="Close Case"
                onClick={() => runAction('close')}
                loading={actionLoading === 'close'}
                variant="muted"
              />
            </div>
          </div>

          {/* Case Meta */}
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h2 className="font-semibold text-gray-900 mb-3">Details</h2>
            <dl className="space-y-2 text-sm">
              <MetaRow label="Confidence" value={c.confidence ? `${(c.confidence * 100).toFixed(0)}%` : '—'} />
              <MetaRow label="Reply Sent" value={c.customer_reply_sent ? `Yes (${formatDate(c.customer_reply_at)})` : 'No'} />
              <MetaRow label="Tech Notified" value={c.tech_notified ? `Yes (${formatDate(c.tech_notified_at)})` : 'No'} />
              <MetaRow label="Follow-ups" value={`${c.followup_count}${c.last_followup_at ? ` (last: ${formatDate(c.last_followup_at)})` : ''}`} />
              <MetaRow label="Received" value={formatDate(c.received_at)} />
              <MetaRow label="Updated" value={formatDate(c.updated_at)} />
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string | null }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
      <div>
        <div className="text-xs text-gray-400">{label}</div>
        <div className="text-gray-800">{value || '—'}</div>
      </div>
    </div>
  );
}

function ActionButton({ icon: Icon, label, onClick, loading, variant }: {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
  loading: boolean;
  variant?: 'danger' | 'muted';
}) {
  const colors = variant === 'danger'
    ? 'border-red-200 text-red-700 hover:bg-red-50'
    : variant === 'muted'
      ? 'border-gray-200 text-gray-500 hover:bg-gray-50'
      : 'border-gray-200 text-gray-700 hover:bg-gray-50';

  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={`w-full flex items-center gap-2 px-3 py-2 border rounded-lg text-sm transition-colors disabled:opacity-50 ${colors}`}
    >
      <Icon className="w-4 h-4" />
      {loading ? 'Processing...' : label}
    </button>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-gray-800 font-medium">{value}</dd>
    </div>
  );
}

function formatDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
