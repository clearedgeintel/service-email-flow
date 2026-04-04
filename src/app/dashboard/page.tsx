'use client';

import { Suspense, useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { StatusBadge, UrgencyBadge, IntentBadge } from '@/components/status-badge';
import { Search, RefreshCw, ChevronLeft, ChevronRight, Filter } from 'lucide-react';

interface CaseRow {
  id: number;
  from_email: string;
  customer_name: string | null;
  subject: string | null;
  status: string;
  intent: string | null;
  urgency_level: string | null;
  trade: string | null;
  received_at: string;
  customer_reply_sent: boolean;
  tech_notified: boolean;
}

const STATUSES = ['', 'RECEIVED', 'CLASSIFIED', 'RESPONDED_PENDING_BOOKING', 'ESCALATED', 'NEEDS_REVIEW', 'NEEDS_MANUAL_CALL', 'CLOSED'];
const INTENTS = ['', 'REPAIR_REQUEST', 'EMERGENCY', 'SALES_INQUIRY', 'GENERAL_QUESTION', 'BILLING', 'VENDOR', 'JOB_APPLICANT', 'SPAM'];
const URGENCIES = ['', 'EMERGENCY', 'TODAY', 'THIS_WEEK', 'ROUTINE'];

export default function CaseQueuePage() {
  return (
    <Suspense fallback={<div className="p-4 md:p-6 text-gray-400">Loading...</div>}>
      <CaseQueueContent />
    </Suspense>
  );
}

function CaseQueueContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [cases, setCases] = useState<CaseRow[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showFilters, setShowFilters] = useState(false);

  const page = parseInt(searchParams.get('page') || '1');
  const status = searchParams.get('status') || '';
  const intent = searchParams.get('intent') || '';
  const urgency = searchParams.get('urgency') || '';
  const search = searchParams.get('search') || '';

  const fetchCases = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', '25');
    if (status) params.set('status', status);
    if (intent) params.set('intent', intent);
    if (urgency) params.set('urgency', urgency);
    if (search) params.set('search', search);

    try {
      const res = await fetch(`/api/cases?${params}`);
      if (res.status === 401) {
        router.push('/login');
        return;
      }
      const data = await res.json();
      setCases(data.cases || []);
      setTotal(data.total || 0);
      setTotalPages(data.totalPages || 0);
    } catch {
      // network error
    } finally {
      setLoading(false);
    }
  }, [page, status, intent, urgency, search, router]);

  useEffect(() => {
    fetchCases();
  }, [fetchCases]);

  const updateFilter = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    params.set('page', '1');
    router.push(`/dashboard?${params}`);
  };

  const goToPage = (p: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', String(p));
    router.push(`/dashboard?${params}`);
  };

  return (
    <div className="p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 md:mb-6">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900">Cases</h1>
          <p className="text-sm text-gray-500 mt-0.5">{total} total</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <Filter className="w-4 h-4" />
            <span className="hidden sm:inline">Filters</span>
          </button>
          <button
            onClick={fetchCases}
            className="flex items-center gap-1.5 px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {/* Search + Filters */}
      <div className="mb-4 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search by name, email, subject..."
            defaultValue={search}
            onKeyDown={(e) => {
              if (e.key === 'Enter') updateFilter('search', (e.target as HTMLInputElement).value);
            }}
            className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          />
        </div>

        {showFilters && (
          <div className="flex flex-wrap gap-2 p-3 bg-white border border-gray-200 rounded-lg">
            <select
              value={status}
              onChange={(e) => updateFilter('status', e.target.value)}
              className="flex-1 min-w-[120px] px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900"
            >
              <option value="">All Statuses</option>
              {STATUSES.filter(Boolean).map((s) => (
                <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
              ))}
            </select>
            <select
              value={intent}
              onChange={(e) => updateFilter('intent', e.target.value)}
              className="flex-1 min-w-[120px] px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900"
            >
              <option value="">All Intents</option>
              {INTENTS.filter(Boolean).map((i) => (
                <option key={i} value={i}>{i.replace(/_/g, ' ')}</option>
              ))}
            </select>
            <select
              value={urgency}
              onChange={(e) => updateFilter('urgency', e.target.value)}
              className="flex-1 min-w-[120px] px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900"
            >
              <option value="">All Urgencies</option>
              {URGENCIES.filter(Boolean).map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Desktop Table */}
      <div className="hidden md:block bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 font-medium text-gray-600">ID</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Customer</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Subject</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Intent</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Urgency</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Received</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-gray-400">Loading...</td>
                </tr>
              ) : cases.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-gray-400">No cases found</td>
                </tr>
              ) : (
                cases.map((c) => (
                  <tr
                    key={c.id}
                    className="border-b border-gray-100 hover:bg-blue-50/50 cursor-pointer transition-colors"
                    onClick={() => router.push(`/dashboard/cases/${c.id}`)}
                  >
                    <td className="px-4 py-3 font-mono text-gray-500">#{c.id}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{c.customer_name || '—'}</div>
                      <div className="text-xs text-gray-500">{c.from_email}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-700 max-w-xs truncate">{c.subject || '(no subject)'}</td>
                    <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                    <td className="px-4 py-3">{c.intent ? <IntentBadge intent={c.intent} /> : '—'}</td>
                    <td className="px-4 py-3">{c.urgency_level ? <UrgencyBadge urgency={c.urgency_level} /> : '—'}</td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                      {new Date(c.received_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50">
            <p className="text-sm text-gray-500">Page {page} of {totalPages}</p>
            <div className="flex gap-1">
              <button onClick={() => goToPage(page - 1)} disabled={page <= 1} className="p-1.5 rounded hover:bg-gray-200 disabled:opacity-30">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button onClick={() => goToPage(page + 1)} disabled={page >= totalPages} className="p-1.5 rounded hover:bg-gray-200 disabled:opacity-30">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Mobile Card View */}
      <div className="md:hidden space-y-3">
        {loading ? (
          <div className="text-center py-12 text-gray-400">Loading...</div>
        ) : cases.length === 0 ? (
          <div className="text-center py-12 text-gray-400">No cases found</div>
        ) : (
          cases.map((c) => (
            <Link
              key={c.id}
              href={`/dashboard/cases/${c.id}`}
              className="block bg-white border border-gray-200 rounded-xl p-4 active:bg-blue-50 transition-colors"
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 truncate">{c.customer_name || c.from_email}</p>
                  <p className="text-xs text-gray-500 truncate mt-0.5">{c.subject || '(no subject)'}</p>
                </div>
                <span className="text-xs text-gray-400 ml-2 whitespace-nowrap">#{c.id}</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                <StatusBadge status={c.status} />
                {c.intent && <IntentBadge intent={c.intent} />}
                {c.urgency_level && <UrgencyBadge urgency={c.urgency_level} />}
              </div>
              <p className="text-xs text-gray-400 mt-2">
                {new Date(c.received_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </p>
            </Link>
          ))
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between py-3">
            <p className="text-sm text-gray-500">Page {page} of {totalPages}</p>
            <div className="flex gap-2">
              <button
                onClick={() => goToPage(page - 1)}
                disabled={page <= 1}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg disabled:opacity-30"
              >
                Prev
              </button>
              <button
                onClick={() => goToPage(page + 1)}
                disabled={page >= totalPages}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg disabled:opacity-30"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
