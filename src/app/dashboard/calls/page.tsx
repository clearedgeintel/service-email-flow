'use client';

import { Suspense, useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, RefreshCw, Filter, ChevronLeft, ChevronRight, PhoneCall, PhoneIncoming, PhoneOutgoing, Voicemail } from 'lucide-react';

interface CallRow {
  id: number;
  retell_call_id: string;
  case_id: number | null;
  direction: 'inbound' | 'outbound';
  status: string;
  from_number: string | null;
  to_number: string | null;
  caller_name: string | null;
  started_at: string | null;
  duration_seconds: number | null;
  summary: string | null;
  sentiment: string | null;
  call_successful: boolean | null;
  in_voicemail: boolean | null;
}

export default function CallsPage() {
  return (
    <Suspense fallback={<div className="p-4 md:p-6 text-gray-400">Loading...</div>}>
      <CallsContent />
    </Suspense>
  );
}

function CallsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [calls, setCalls] = useState<CallRow[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showFilters, setShowFilters] = useState(false);

  const page = parseInt(searchParams.get('page') || '1');
  const direction = searchParams.get('direction') || '';
  const sentiment = searchParams.get('sentiment') || '';
  const search = searchParams.get('search') || '';

  const fetchCalls = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', '25');
    if (direction) params.set('direction', direction);
    if (sentiment) params.set('sentiment', sentiment);
    if (search) params.set('search', search);

    try {
      const res = await fetch(`/api/calls?${params}`);
      if (res.status === 401) { router.push('/login'); return; }
      const data = await res.json();
      setCalls(data.calls || []);
      setTotal(data.total || 0);
      setTotalPages(data.totalPages || 0);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [page, direction, sentiment, search, router]);

  useEffect(() => { fetchCalls(); }, [fetchCalls]);

  const updateFilter = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value); else params.delete(key);
    params.set('page', '1');
    router.push(`/dashboard/calls?${params}`);
  };

  const goToPage = (p: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', String(p));
    router.push(`/dashboard/calls?${params}`);
  };

  const sentimentBadge = (s: string | null) => {
    if (!s) return null;
    const colors =
      s === 'Positive' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' :
      s === 'Negative' ? 'bg-red-50 text-red-700 border-red-100' :
      'bg-slate-50 text-slate-600 border-slate-200';
    return <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] border ${colors}`}>{s}</span>;
  };

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return '—';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  return (
    <div className="p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 md:mb-6">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-gray-100">Voice Calls</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{total} total</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:text-gray-200 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            <Filter className="w-4 h-4" />
            <span className="hidden sm:inline">Filters</span>
          </button>
          <button
            onClick={() => fetchCalls()}
            className="flex items-center gap-1.5 px-3 py-2 text-sm bg-[#185FA5] text-white rounded-lg hover:bg-[#0C447C] transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {/* Search + Filters */}
      <div className="mb-4 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
          <input
            type="text"
            placeholder="Search by caller name, phone, or summary..."
            defaultValue={search}
            onKeyDown={(e) => {
              if (e.key === 'Enter') updateFilter('search', (e.target as HTMLInputElement).value);
            }}
            className="w-full pl-9 pr-4 py-2.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>

        {showFilters && (
          <div className="flex flex-wrap gap-2 p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
            <select
              value={direction}
              onChange={(e) => updateFilter('direction', e.target.value)}
              className="flex-1 min-w-[120px] px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-900 rounded-lg text-sm text-gray-900 dark:text-gray-100"
            >
              <option value="">All Directions</option>
              <option value="inbound">Inbound</option>
              <option value="outbound">Outbound</option>
            </select>
            <select
              value={sentiment}
              onChange={(e) => updateFilter('sentiment', e.target.value)}
              className="flex-1 min-w-[120px] px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-900 rounded-lg text-sm text-gray-900 dark:text-gray-100"
            >
              <option value="">All Sentiment</option>
              <option value="Positive">Positive</option>
              <option value="Neutral">Neutral</option>
              <option value="Negative">Negative</option>
            </select>
          </div>
        )}
      </div>

      {/* Desktop Table */}
      <div className="hidden md:block bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
                <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Direction</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Caller</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Summary</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Duration</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Sentiment</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Case</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Started</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="text-center py-12 text-gray-400">Loading...</td></tr>
              ) : calls.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-12 text-gray-400">No calls yet — connect Retell in Settings</td></tr>
              ) : (
                calls.map((c) => (
                  <tr key={c.id} className="border-b border-gray-100 dark:border-gray-700 hover:bg-blue-50/50 dark:hover:bg-gray-700/50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        {c.direction === 'inbound' ? (
                          <PhoneIncoming className="w-4 h-4 text-blue-600" />
                        ) : (
                          <PhoneOutgoing className="w-4 h-4 text-violet-600" />
                        )}
                        <span className="text-xs text-gray-600 dark:text-gray-300 capitalize">{c.direction}</span>
                        {c.in_voicemail && <Voicemail className="w-3.5 h-3.5 text-amber-500 ml-1" aria-label="Voicemail" />}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900 dark:text-gray-100">{c.caller_name || '—'}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {c.direction === 'inbound' ? c.from_number : c.to_number}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300 max-w-md truncate">{c.summary || '—'}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">{formatDuration(c.duration_seconds)}</td>
                    <td className="px-4 py-3">{sentimentBadge(c.sentiment)}</td>
                    <td className="px-4 py-3">
                      {c.case_id ? (
                        <Link href={`/dashboard/cases/${c.case_id}`} className="text-[#185FA5] dark:text-[#378ADD] hover:underline text-xs">#{c.case_id}</Link>
                      ) : (
                        <span className="text-gray-400 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap text-xs">
                      {c.started_at ? new Date(c.started_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
            <p className="text-sm text-gray-500 dark:text-gray-400">Page {page} of {totalPages}</p>
            <div className="flex gap-1">
              <button onClick={() => goToPage(page - 1)} disabled={page <= 1} className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-30">
                <ChevronLeft className="w-4 h-4 dark:text-gray-300" />
              </button>
              <button onClick={() => goToPage(page + 1)} disabled={page >= totalPages} className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-30">
                <ChevronRight className="w-4 h-4 dark:text-gray-300" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {loading ? (
          <div className="text-center py-12 text-gray-400">Loading...</div>
        ) : calls.length === 0 ? (
          <div className="text-center py-12 text-gray-400">No calls yet</div>
        ) : (
          calls.map((c) => (
            <div key={c.id} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  {c.direction === 'inbound' ? (
                    <PhoneIncoming className="w-4 h-4 text-blue-600" />
                  ) : (
                    <PhoneOutgoing className="w-4 h-4 text-violet-600" />
                  )}
                  <div>
                    <p className="font-medium text-gray-900 dark:text-gray-100">{c.caller_name || c.from_number || c.to_number || '—'}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{formatDuration(c.duration_seconds)}</p>
                  </div>
                </div>
                {c.case_id && (
                  <Link href={`/dashboard/cases/${c.case_id}`} className="text-xs text-[#185FA5] hover:underline">Case #{c.case_id}</Link>
                )}
              </div>
              {c.summary && <p className="text-xs text-gray-600 dark:text-gray-300 mt-1 line-clamp-2">{c.summary}</p>}
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                {sentimentBadge(c.sentiment)}
                {c.in_voicemail && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] border bg-amber-50 text-amber-700 border-amber-100">
                    Voicemail
                  </span>
                )}
              </div>
              <p className="text-[11px] text-gray-400 mt-2">
                {c.started_at ? new Date(c.started_at).toLocaleString() : '—'}
              </p>
            </div>
          ))
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between py-3">
            <p className="text-sm text-gray-500 dark:text-gray-400">Page {page} of {totalPages}</p>
            <div className="flex gap-2">
              <button onClick={() => goToPage(page - 1)} disabled={page <= 1} className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 dark:text-gray-200 rounded-lg disabled:opacity-30">Prev</button>
              <button onClick={() => goToPage(page + 1)} disabled={page >= totalPages} className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 dark:text-gray-200 rounded-lg disabled:opacity-30">Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
