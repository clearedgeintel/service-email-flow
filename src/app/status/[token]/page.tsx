'use client';

import { useEffect, useState, use } from 'react';
import { Calendar, CheckCircle2, Clock, AlertTriangle, Mail } from 'lucide-react';

interface PublicCaseData {
  case_short_id: string;
  received_at: string;
  subject: string | null;
  customer_name: string | null;
  status: string;
  status_description: string;
  intent: string | null;
  urgency_level: string | null;
  trade: string | null;
  problem_summary: string | null;
  reply_sent_at: string | null;
  tech_notified: boolean;
  booking: {
    status: string | null;
    start_at: string | null;
    end_at: string | null;
  } | null;
  timeline: Array<{ event: string; at: string }>;
}

function BrandIcon({ className = 'w-14 h-14' }: { className?: string }) {
  return (
    <svg viewBox="0 0 86 86" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="86" height="86" rx="16" fill="#0C447C" />
      <path d="M 16,69 Q 43,39 70,69" fill="none" stroke="white" strokeWidth="4.5" strokeLinecap="round" opacity="0.28" />
      <path d="M 24,69 Q 43,50 62,69" fill="none" stroke="white" strokeWidth="4.5" strokeLinecap="round" opacity="0.58" />
      <path d="M 33,69 Q 43,60 53,69" fill="none" stroke="white" strokeWidth="4.5" strokeLinecap="round" opacity="1" />
      <circle cx="43" cy="75" r="6.5" fill="#378ADD" opacity="0.4" />
      <circle cx="43" cy="75" r="4" fill="white" />
    </svg>
  );
}

function statusIcon(status: string) {
  if (status.includes('Urgent') || status.includes('Escalated')) {
    return <AlertTriangle className="w-5 h-5 text-red-600" />;
  }
  if (status.includes('Completed') || status.includes('Booked')) {
    return <CheckCircle2 className="w-5 h-5 text-emerald-600" />;
  }
  return <Clock className="w-5 h-5 text-[#185FA5]" />;
}

export default function StatusPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [data, setData] = useState<PublicCaseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/public/case/${token}`)
      .then(async (res) => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Unknown error' }));
          setError(err.error || 'Unable to load this case');
          return;
        }
        const body = await res.json();
        setData(body.case);
      })
      .catch(() => setError('Network error'))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0B1A2E] via-[#0C447C] to-[#0B1A2E]">
        <p className="text-slate-300 text-sm">Loading your case status...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-[#0B1A2E] via-[#0C447C] to-[#0B1A2E]">
        <div className="max-w-md w-full bg-white rounded-xl shadow-xl p-8 text-center">
          <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
          <h1 className="text-xl font-semibold text-gray-900 mb-2">Case Not Found</h1>
          <p className="text-sm text-gray-600">
            {error || 'This status link may have expired or is no longer valid.'}
          </p>
          <p className="text-xs text-gray-500 mt-6">
            If you believe this is an error, please reply to the original email or contact us directly.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-gradient-to-br from-[#0B1A2E] via-[#0C447C] to-[#0B1A2E] text-white">
        <div className="max-w-3xl mx-auto px-4 py-8 flex items-center gap-4">
          <BrandIcon className="w-12 h-12 shrink-0" />
          <div>
            <h1 className="text-xl font-semibold">
              <span className="text-[#378ADD]">Clear</span>Desk
            </h1>
            <p className="text-xs text-slate-300 tracking-wider uppercase mt-0.5">Case Status</p>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {/* Status hero */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <div className="flex items-start gap-3">
            {statusIcon(data.status)}
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-500">Current status · Case {data.case_short_id}</p>
              <h2 className="text-2xl font-semibold text-gray-900 mt-0.5">{data.status}</h2>
              {data.status_description && (
                <p className="text-sm text-gray-600 mt-2">{data.status_description}</p>
              )}
            </div>
          </div>
        </div>

        {/* Booking, if present */}
        {data.booking && data.booking.start_at && (
          <div className={`border rounded-xl p-5 ${
            data.booking.status === 'cancelled'
              ? 'bg-red-50 border-red-200'
              : data.booking.status === 'completed'
                ? 'bg-slate-50 border-slate-200'
                : 'bg-emerald-50 border-emerald-200'
          }`}>
            <div className="flex items-center gap-2 mb-3">
              <Calendar className={`w-5 h-5 ${
                data.booking.status === 'cancelled' ? 'text-red-600' :
                data.booking.status === 'completed' ? 'text-slate-600' : 'text-emerald-600'
              }`} />
              <h3 className="font-semibold text-gray-900">
                Appointment {data.booking.status === 'booked' ? 'Scheduled' : data.booking.status === 'cancelled' ? 'Cancelled' : data.booking.status === 'completed' ? 'Completed' : 'Upcoming'}
              </h3>
            </div>
            <p className="text-sm text-gray-800 font-medium">
              {new Date(data.booking.start_at).toLocaleString(undefined, {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })}
            </p>
            {data.booking.end_at && data.booking.start_at !== data.booking.end_at && (
              <p className="text-xs text-gray-500 mt-1">
                Until {new Date(data.booking.end_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
              </p>
            )}
          </div>
        )}

        {/* Case details */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h3 className="font-semibold text-gray-900 mb-3">Your Request</h3>
          <dl className="space-y-2 text-sm">
            {data.customer_name && (
              <div className="flex justify-between">
                <dt className="text-gray-500">Name</dt>
                <dd className="text-gray-900 font-medium">{data.customer_name}</dd>
              </div>
            )}
            {data.subject && (
              <div className="flex justify-between">
                <dt className="text-gray-500">Subject</dt>
                <dd className="text-gray-900 font-medium text-right ml-4">{data.subject}</dd>
              </div>
            )}
            {data.problem_summary && (
              <div className="pt-2 border-t border-gray-100">
                <dt className="text-gray-500 mb-1">Summary</dt>
                <dd className="text-gray-700">{data.problem_summary}</dd>
              </div>
            )}
            <div className="flex justify-between pt-2 border-t border-gray-100">
              <dt className="text-gray-500">Received</dt>
              <dd className="text-gray-700">
                {new Date(data.received_at).toLocaleString(undefined, {
                  month: 'short', day: 'numeric', year: 'numeric',
                  hour: 'numeric', minute: '2-digit',
                })}
              </dd>
            </div>
            {data.reply_sent_at && (
              <div className="flex justify-between">
                <dt className="text-gray-500">Reply sent</dt>
                <dd className="text-gray-700">
                  {new Date(data.reply_sent_at).toLocaleString(undefined, {
                    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                  })}
                </dd>
              </div>
            )}
          </dl>
        </div>

        {/* Timeline */}
        {data.timeline.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="font-semibold text-gray-900 mb-4">Timeline</h3>
            <ol className="space-y-3">
              {data.timeline.map((t, i) => (
                <li key={i} className="flex gap-3 text-sm">
                  <div className="w-2 h-2 rounded-full bg-[#185FA5] mt-1.5 shrink-0" />
                  <div className="flex-1">
                    <p className="text-gray-800">{t.event}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {new Date(t.at).toLocaleString(undefined, {
                        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                      })}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Help footer */}
        <div className="text-center text-xs text-gray-500 py-6 flex items-center justify-center gap-2">
          <Mail className="w-3.5 h-3.5" />
          Need help? Reply to the email we sent you.
        </div>
      </main>
    </div>
  );
}
