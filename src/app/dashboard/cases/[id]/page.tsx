'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { StatusBadge, UrgencyBadge, IntentBadge } from '@/components/status-badge';
import {
  ArrowLeft, RefreshCw, Send, AlertTriangle, X, MessageSquare, Clock,
  User, Mail, Phone, MapPin, FileText, Calendar, CheckCircle2, PhoneCall,
  MessageCircle,
} from 'lucide-react';

interface CallRecord {
  id: number;
  retell_call_id: string;
  direction: 'inbound' | 'outbound';
  status: string;
  from_number: string | null;
  to_number: string | null;
  caller_name: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  disconnection_reason: string | null;
  transcript: string | null;
  recording_url: string | null;
  summary: string | null;
  sentiment: string | null;
  call_successful: boolean | null;
  in_voicemail: boolean | null;
  custom_data: Record<string, unknown> | null;
}

interface SmsMessage {
  id: number;
  twilio_sid: string;
  direction: 'inbound' | 'outbound';
  status: string;
  from_number: string;
  to_number: string;
  body: string | null;
  num_media: number;
  media_urls: string[] | null;
  error_code: string | null;
  error_message: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  received_at: string | null;
  created_at: string;
}

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
  draft_reply: {
    subject: string;
    body_text: string;
    body_html: string;
    to: string;
    created_at: string;
    used_fallback?: boolean;
    type?: 'reply' | 'followup';
    followup_number?: number;
  } | null;
}

interface TimelineEvent {
  id: number;
  event_type: string;
  actor: string;
  summary: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export default function CaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [caseData, setCaseData] = useState<CaseDetail | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [expandedCall, setExpandedCall] = useState<number | null>(null);
  const [messages, setMessages] = useState<SmsMessage[]>([]);
  const [smsBody, setSmsBody] = useState('');
  const [smsSending, setSmsSending] = useState(false);
  const [smsError, setSmsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState('');
  const [actionResult, setActionResult] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  const [selectedEvent, setSelectedEvent] = useState<TimelineEvent | null>(null);
  const [showDraftHtml, setShowDraftHtml] = useState(false);

  const fetchCase = async () => {
    try {
      const [caseRes, callsRes, msgRes] = await Promise.all([
        fetch(`/api/cases/${id}`),
        fetch(`/api/cases/${id}/calls`).catch(() => null),
        fetch(`/api/cases/${id}/messages`).catch(() => null),
      ]);
      if (caseRes.status === 401) { router.push('/login'); return; }
      if (caseRes.status === 404) { router.push('/dashboard'); return; }
      const data = await caseRes.json();
      setCaseData(data.case);
      setTimeline(data.timeline || []);
      if (callsRes && callsRes.ok) {
        const callsData = await callsRes.json();
        setCalls(callsData.calls || []);
      }
      if (msgRes && msgRes.ok) {
        const msgData = await msgRes.json();
        setMessages(msgData.messages || []);
      }
    } catch { /* */ } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchCase(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const runAction = async (action: string, body?: object) => {
    setActionLoading(action);
    setActionResult(null);
    try {
      const res = await fetch(`/api/cases/${id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        if (data?.message) setActionResult(`✓ ${data.message}`);
        await fetchCase();
      } else {
        setActionResult(`✗ ${data?.error || 'Action failed'}`);
      }
    } finally {
      setActionLoading('');
      if (actionResult) setTimeout(() => setActionResult(null), 6000);
    }
  };

  const addNote = async () => {
    if (!noteText.trim()) return;
    await runAction('add-note', { note: noteText });
    setNoteText('');
  };

  const sendSms = async () => {
    if (!smsBody.trim()) return;
    setSmsSending(true);
    setSmsError(null);
    try {
      const res = await fetch(`/api/cases/${id}/send-sms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: smsBody }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        setSmsBody('');
        await fetchCase();
      } else {
        setSmsError(data?.error || 'Failed to send SMS');
      }
    } finally {
      setSmsSending(false);
    }
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
          {/* Draft Reply Preview */}
          {c.draft_reply && (
            <div className="bg-amber-50 border-2 border-amber-300 rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-5 h-5 text-amber-700" />
                  <h2 className="font-semibold text-amber-900">
                    {c.draft_reply.type === 'followup'
                      ? `Pending Follow-up #${c.draft_reply.followup_number || '?'}`
                      : 'Pending Draft Reply'}
                  </h2>
                  {c.draft_reply.used_fallback && (
                    <span className="text-xs bg-amber-200 text-amber-900 px-2 py-0.5 rounded">Template fallback</span>
                  )}
                </div>
                <button
                  onClick={() => setShowDraftHtml(!showDraftHtml)}
                  className="text-xs text-amber-700 hover:underline"
                >
                  {showDraftHtml ? 'Show text' : 'Show HTML preview'}
                </button>
              </div>
              <div className="text-xs text-amber-800 mb-2">
                <div><strong>To:</strong> {c.draft_reply.to}</div>
                <div><strong>Subject:</strong> {c.draft_reply.subject}</div>
              </div>
              {showDraftHtml ? (
                <div
                  className="bg-white border border-amber-200 rounded-lg p-3 max-h-96 overflow-y-auto"
                  dangerouslySetInnerHTML={{ __html: c.draft_reply.body_html }}
                />
              ) : (
                <pre className="bg-white border border-amber-200 rounded-lg p-3 text-sm text-gray-800 whitespace-pre-wrap font-sans max-h-96 overflow-y-auto">
                  {c.draft_reply.body_text}
                </pre>
              )}
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => runAction('approve-reply')}
                  disabled={actionLoading === 'approve-reply'}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 disabled:opacity-50"
                >
                  <Send className="w-4 h-4" />
                  {actionLoading === 'approve-reply' ? 'Sending...' : 'Approve & Send'}
                </button>
                <button
                  onClick={() => runAction('discard-reply')}
                  disabled={actionLoading === 'discard-reply'}
                  className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50"
                >
                  <X className="w-4 h-4" />
                  Discard
                </button>
              </div>
            </div>
          )}

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

          {/* Calls */}
          {calls.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <PhoneCall className="w-4 h-4 text-[#185FA5]" />
                <h2 className="font-semibold text-gray-900">Voice Calls ({calls.length})</h2>
              </div>
              <div className="space-y-3">
                {calls.map((call) => {
                  const isExpanded = expandedCall === call.id;
                  const duration = call.duration_seconds
                    ? `${Math.floor(call.duration_seconds / 60)}m ${call.duration_seconds % 60}s`
                    : '—';
                  return (
                    <div key={call.id} className="border border-gray-200 rounded-lg p-3">
                      <button
                        onClick={() => setExpandedCall(isExpanded ? null : call.id)}
                        className="w-full flex items-start justify-between text-left"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-[11px] px-1.5 py-0.5 rounded-full border ${
                              call.direction === 'inbound'
                                ? 'bg-blue-50 text-blue-700 border-blue-100'
                                : 'bg-violet-50 text-violet-700 border-violet-100'
                            }`}>
                              {call.direction === 'inbound' ? '↓ Inbound' : '↑ Outbound'}
                            </span>
                            <span className={`text-[11px] px-1.5 py-0.5 rounded-full border ${
                              call.status === 'ended'
                                ? 'bg-slate-50 text-slate-600 border-slate-200'
                                : call.status === 'in_progress'
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                                  : 'bg-amber-50 text-amber-700 border-amber-100'
                            }`}>
                              {call.status}
                            </span>
                            {call.sentiment && (
                              <span className={`text-[11px] px-1.5 py-0.5 rounded-full border ${
                                call.sentiment === 'Positive'
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                                  : call.sentiment === 'Negative'
                                    ? 'bg-red-50 text-red-700 border-red-100'
                                    : 'bg-slate-50 text-slate-600 border-slate-200'
                              }`}>
                                {call.sentiment}
                              </span>
                            )}
                            {call.in_voicemail && (
                              <span className="text-[11px] px-1.5 py-0.5 rounded-full border bg-amber-50 text-amber-700 border-amber-100">
                                Voicemail
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-gray-900 mt-1">
                            {call.direction === 'inbound' ? call.from_number : call.to_number} · {duration}
                          </p>
                          {call.summary && (
                            <p className="text-xs text-gray-600 mt-1 line-clamp-2">{call.summary}</p>
                          )}
                          <p className="text-[11px] text-gray-400 mt-1">
                            {call.started_at ? new Date(call.started_at).toLocaleString() : '—'}
                          </p>
                        </div>
                        <span className="text-gray-400 text-sm ml-2">{isExpanded ? '−' : '+'}</span>
                      </button>

                      {isExpanded && (
                        <div className="mt-3 pt-3 border-t border-gray-100 space-y-3 text-sm">
                          {call.recording_url && (
                            <div>
                              <p className="text-xs font-medium text-gray-500 uppercase mb-1">Recording</p>
                              <audio controls src={call.recording_url} className="w-full" />
                            </div>
                          )}
                          {call.transcript && (
                            <div>
                              <p className="text-xs font-medium text-gray-500 uppercase mb-1">Transcript</p>
                              <pre className="text-xs text-gray-700 whitespace-pre-wrap font-sans bg-gray-50 border border-gray-200 rounded p-3 max-h-64 overflow-y-auto">
                                {call.transcript}
                              </pre>
                            </div>
                          )}
                          {call.custom_data && Object.keys(call.custom_data).length > 0 && (
                            <div>
                              <p className="text-xs font-medium text-gray-500 uppercase mb-1">Extracted data</p>
                              <dl className="text-xs space-y-0.5">
                                {Object.entries(call.custom_data).map(([k, v]) => (
                                  <div key={k} className="flex gap-2">
                                    <dt className="text-gray-500 font-mono">{k}:</dt>
                                    <dd className="text-gray-800">{String(v)}</dd>
                                  </div>
                                ))}
                              </dl>
                            </div>
                          )}
                          {call.disconnection_reason && (
                            <p className="text-xs text-gray-500">
                              Ended: {call.disconnection_reason.replace(/_/g, ' ')}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* SMS Messages */}
          {(messages.length > 0 || c.customer_phone) && (
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <MessageCircle className="w-4 h-4 text-[#185FA5]" />
                <h2 className="font-semibold text-gray-900">
                  SMS {messages.length > 0 ? `(${messages.length})` : ''}
                </h2>
              </div>

              {messages.length > 0 && (
                <div className="space-y-2 mb-3 max-h-96 overflow-y-auto pr-1">
                  {messages.map((m) => (
                    <div
                      key={m.id}
                      className={`flex ${m.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[80%] px-3 py-2 rounded-lg border text-sm ${
                          m.direction === 'outbound'
                            ? 'bg-blue-50 text-blue-900 border-blue-100'
                            : 'bg-gray-50 text-gray-900 border-gray-200'
                        }`}
                      >
                        <div className="flex items-center gap-2 text-[10px] opacity-60 mb-0.5 uppercase tracking-wide">
                          <span>{m.direction === 'outbound' ? 'Sent' : 'Received'}</span>
                          <span>·</span>
                          <span>{m.status}</span>
                          {m.error_code && <span className="text-red-600">· {m.error_code}</span>}
                        </div>
                        <p className="whitespace-pre-wrap">{m.body || <em>(no body)</em>}</p>
                        {m.media_urls && m.media_urls.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {m.media_urls.map((url, i) => (
                              <a key={i} href={url} target="_blank" rel="noreferrer" className="text-[11px] underline opacity-70">
                                media-{i + 1}
                              </a>
                            ))}
                          </div>
                        )}
                        <p className="text-[10px] opacity-50 mt-1">
                          {new Date(m.sent_at || m.received_at || m.created_at).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {c.customer_phone && (
                <div className="border-t border-gray-100 pt-3">
                  <label className="text-xs text-gray-500 mb-1 block">
                    Send SMS to {c.customer_phone}
                  </label>
                  <div className="flex gap-2">
                    <textarea
                      value={smsBody}
                      onChange={(e) => setSmsBody(e.target.value)}
                      placeholder="Type a message..."
                      maxLength={1600}
                      rows={2}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none focus:ring-2 focus:ring-blue-500 outline-none"
                      disabled={smsSending}
                    />
                    <button
                      onClick={sendSms}
                      disabled={smsSending || !smsBody.trim()}
                      className="px-4 py-2 bg-[#185FA5] text-white rounded-lg text-sm hover:bg-[#0C447C] disabled:opacity-50 flex items-center gap-1.5 self-stretch"
                    >
                      <Send className="w-3.5 h-3.5" />
                      {smsSending ? 'Sending' : 'Send'}
                    </button>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[11px] text-gray-400">{smsBody.length}/1600</span>
                    {smsError && <span className="text-[11px] text-red-600">{smsError}</span>}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Timeline */}
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h2 className="font-semibold text-gray-900 mb-3">Timeline</h2>
            {timeline.length === 0 ? (
              <p className="text-sm text-gray-400">No events</p>
            ) : (
              <div className="space-y-1">
                {timeline.map((evt) =>
                  evt.event_type === 'VOICE_TRANSCRIPT' ? (
                    <VoiceTranscriptEvent key={evt.id} evt={evt} />
                  ) : (
                    <button
                      key={evt.id}
                      onClick={() => setSelectedEvent(evt)}
                      className="w-full flex gap-3 text-sm text-left p-2 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      <div className="w-2 h-2 rounded-full bg-blue-400 mt-1.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-gray-800">{evt.event_type.replace(/_/g, ' ')}</span>
                          <span className="text-xs text-gray-400">
                            {new Date(evt.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </span>
                          {evt.actor !== 'system' && (
                            <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">{evt.actor}</span>
                          )}
                        </div>
                        {evt.summary && <p className="text-gray-600 mt-0.5 truncate">{evt.summary}</p>}
                      </div>
                    </button>
                  ),
                )}
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
              {c.customer_phone && (
                <ActionButton
                  icon={PhoneCall}
                  label="Call Customer"
                  onClick={async () => {
                    if (!confirm(`Trigger an outbound Retell call to ${c.customer_phone}?`)) return;
                    setActionLoading('call-customer');
                    setActionResult(null);
                    try {
                      let res = await fetch(`/api/cases/${id}/call-customer`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                      });
                      if (res.status === 409) {
                        const data = await res.json().catch(() => null);
                        if (data?.after_hours && confirm('Outside configured business hours. Call anyway?')) {
                          res = await fetch(`/api/cases/${id}/call-customer`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ force: true }),
                          });
                        } else {
                          setActionResult('✗ Outside business hours');
                          return;
                        }
                      }
                      const data = await res.json().catch(() => null);
                      if (res.ok) {
                        if (data?.message) setActionResult(`✓ ${data.message}`);
                        await fetchCase();
                      } else {
                        setActionResult(`✗ ${data?.error || 'Call failed'}`);
                      }
                    } finally {
                      setActionLoading('');
                    }
                  }}
                  loading={actionLoading === 'call-customer'}
                />
              )}
              <ActionButton
                icon={X}
                label="Close Case"
                onClick={() => runAction('close')}
                loading={actionLoading === 'close'}
                variant="muted"
              />
            </div>
            {actionResult && (
              <p className={`text-xs mt-3 ${actionResult.startsWith('✓') ? 'text-emerald-700' : 'text-red-700'}`}>
                {actionResult}
              </p>
            )}
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

      {/* Event detail modal */}
      {selectedEvent && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={() => setSelectedEvent(null)}
        >
          <div
            className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-5 border-b border-gray-200">
              <div>
                <h3 className="font-semibold text-gray-900">{selectedEvent.event_type.replace(/_/g, ' ')}</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  {new Date(selectedEvent.created_at).toLocaleString()} · by {selectedEvent.actor}
                </p>
              </div>
              <button
                onClick={() => setSelectedEvent(null)}
                className="p-1 rounded hover:bg-gray-100"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto flex-1">
              {selectedEvent.summary && (
                <div className="mb-4">
                  <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1">Summary</h4>
                  <p className="text-sm text-gray-800 whitespace-pre-wrap">{selectedEvent.summary}</p>
                </div>
              )}
              {selectedEvent.metadata && Object.keys(selectedEvent.metadata).length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1">Metadata</h4>
                  <pre className="text-xs bg-gray-50 border border-gray-200 rounded-lg p-3 overflow-x-auto font-mono text-gray-800">
                    {JSON.stringify(selectedEvent.metadata, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function VoiceTranscriptEvent({ evt }: { evt: TimelineEvent }) {
  const [open, setOpen] = useState(false);
  const meta = (evt.metadata || {}) as Record<string, unknown>;
  const turns = Array.isArray(meta.turns) ? (meta.turns as Array<{ role: string; content: string }>) : [];
  const direction = meta.direction as string | undefined;
  const durationSec = meta.duration_seconds as number | null | undefined;
  const sentiment = meta.sentiment as string | null | undefined;
  const recordingUrl = meta.recording_url as string | null | undefined;

  const durLabel = durationSec != null
    ? `${Math.floor(durationSec / 60)}m ${durationSec % 60}s`
    : null;

  return (
    <div className="flex gap-3 text-sm p-2 rounded-lg">
      <div className="w-2 h-2 rounded-full bg-violet-400 mt-1.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <button
          onClick={() => setOpen(!open)}
          className="w-full text-left hover:bg-gray-50 rounded-md -m-1 p-1 transition-colors"
        >
          <div className="flex items-center gap-2 flex-wrap">
            <PhoneCall className="w-3.5 h-3.5 text-violet-600" />
            <span className="font-medium text-gray-800">Voice call</span>
            {direction && (
              <span className="text-[11px] text-gray-500 capitalize">{direction}</span>
            )}
            {durLabel && <span className="text-[11px] text-gray-500">· {durLabel}</span>}
            {turns.length > 0 && <span className="text-[11px] text-gray-500">· {turns.length} turns</span>}
            {sentiment && (
              <span className={`text-[11px] px-1.5 py-0.5 rounded ${
                sentiment === 'Positive' ? 'bg-emerald-50 text-emerald-700' :
                sentiment === 'Negative' ? 'bg-red-50 text-red-700' :
                'bg-slate-50 text-slate-600'
              }`}>{sentiment}</span>
            )}
            <span className="text-xs text-gray-400 ml-auto">
              {new Date(evt.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
          {evt.summary && !open && (
            <p className="text-gray-600 mt-0.5 truncate">{evt.summary}</p>
          )}
        </button>

        {open && (
          <div className="mt-2 space-y-2">
            {evt.summary && (
              <p className="text-xs text-gray-600 italic border-l-2 border-gray-200 pl-2">{evt.summary}</p>
            )}
            {recordingUrl && (
              <audio controls src={recordingUrl} className="w-full h-8" />
            )}
            {turns.length === 0 ? (
              <p className="text-xs text-gray-400">No transcript available</p>
            ) : (
              <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
                {turns.map((t, i) => (
                  <div
                    key={i}
                    className={`flex gap-2 text-xs ${t.role === 'agent' ? 'pr-8' : 'pl-8 justify-end'}`}
                  >
                    <div
                      className={`px-2.5 py-1.5 rounded-lg max-w-[85%] ${
                        t.role === 'agent'
                          ? 'bg-violet-50 text-violet-900 border border-violet-100'
                          : 'bg-blue-50 text-blue-900 border border-blue-100'
                      }`}
                    >
                      <div className="text-[10px] font-medium opacity-60 mb-0.5 capitalize">
                        {t.role === 'agent' ? 'Agent' : 'Customer'}
                      </div>
                      <div className="whitespace-pre-wrap">{t.content}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
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
