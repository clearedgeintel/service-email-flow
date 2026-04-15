'use client';

import { Suspense, useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { StatusBadge, UrgencyBadge, IntentBadge } from '@/components/status-badge';
import { Search, RefreshCw, ChevronLeft, ChevronRight, Filter, Download, Bookmark, X as CloseIcon, AlertTriangle, X as XIcon, Activity, Mail } from 'lucide-react';

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

interface SavedFilter {
  name: string;
  params: Record<string, string>;
}

const STATUSES = ['', 'RECEIVED', 'CLASSIFIED', 'RESPONDED_PENDING_BOOKING', 'ESCALATED', 'NEEDS_REVIEW', 'NEEDS_MANUAL_CALL', 'CLOSED'];
const INTENTS = ['', 'REPAIR_REQUEST', 'EMERGENCY', 'SALES_INQUIRY', 'GENERAL_QUESTION', 'BILLING', 'VENDOR', 'JOB_APPLICANT', 'SPAM'];
const URGENCIES = ['', 'EMERGENCY', 'TODAY', 'THIS_WEEK', 'ROUTINE'];

const SAVED_FILTERS_KEY = 'serviceflow:saved-filters';
const POLL_INTERVAL_MS = 30_000;

export default function CaseQueuePage() {
  return (
    <Suspense fallback={<div className="p-4 md:p-6 text-gray-400 dark:text-gray-500">Loading...</div>}>
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
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([]);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [newFilterName, setNewFilterName] = useState('');
  const [newCasesCount, setNewCasesCount] = useState(0);
  const [polling, setPolling] = useState(false);
  const [pollResult, setPollResult] = useState<string | null>(null);
  const [showPollLog, setShowPollLog] = useState(false);
  const [pollHistory, setPollHistory] = useState<Array<{
    id: number;
    started_at: string;
    finished_at: string | null;
    duration_ms: number | null;
    messages_found: number;
    cases_inserted: number;
    error: string | null;
    metadata: Record<string, unknown> | null;
  }>>([]);
  const [pollStats, setPollStats] = useState<{ total_polls: number; messages_found: number; errors: number } | null>(null);
  const lastTotalRef = useRef<number>(0);

  const page = parseInt(searchParams.get('page') || '1');
  const status = searchParams.get('status') || '';
  const intent = searchParams.get('intent') || '';
  const urgency = searchParams.get('urgency') || '';
  const search = searchParams.get('search') || '';

  // Load saved filters from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(SAVED_FILTERS_KEY);
      if (stored) setSavedFilters(JSON.parse(stored));
    } catch {
      // ignore
    }
  }, []);

  const fetchCases = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
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
      const newTotal = data.total || 0;

      // Detect new cases during silent polling
      if (silent && lastTotalRef.current > 0 && newTotal > lastTotalRef.current) {
        setNewCasesCount(newTotal - lastTotalRef.current);
      } else if (!silent) {
        setCases(data.cases || []);
        setTotal(newTotal);
        setTotalPages(data.totalPages || 0);
        setNewCasesCount(0);
      }
      lastTotalRef.current = newTotal;
    } catch {
      // network error
    } finally {
      if (!silent) setLoading(false);
    }
  }, [page, status, intent, urgency, search, router]);

  useEffect(() => {
    fetchCases();
    setSelectedIds(new Set());
  }, [fetchCases]);

  // Real-time polling
  useEffect(() => {
    const interval = setInterval(() => fetchCases(true), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
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

  // Bulk actions
  const toggleAll = () => {
    if (selectedIds.size === cases.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(cases.map((c) => c.id)));
    }
  };

  const toggleOne = (id: number) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedIds(next);
  };

  const bulkAction = async (action: string) => {
    if (selectedIds.size === 0) return;
    if (action === 'close' && !confirm(`Close ${selectedIds.size} cases?`)) return;

    setBulkLoading(true);
    try {
      await fetch('/api/cases/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, case_ids: Array.from(selectedIds) }),
      });
      setSelectedIds(new Set());
      fetchCases();
    } finally {
      setBulkLoading(false);
    }
  };

  // Export CSV
  const exportCsv = () => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (intent) params.set('intent', intent);
    if (urgency) params.set('urgency', urgency);
    if (search) params.set('search', search);
    window.location.href = `/api/cases/export?${params}`;
  };

  // Load poll history (for the poll log panel)
  const loadPollHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/polls?limit=50');
      if (res.ok) {
        const data = await res.json();
        setPollHistory(data.polls || []);
        setPollStats(data.stats_24h || null);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (showPollLog) {
      loadPollHistory();
      const interval = setInterval(loadPollHistory, 15_000);
      return () => clearInterval(interval);
    }
  }, [showPollLog, loadPollHistory]);

  // Poll Gmail now (manual trigger)
  const pollNow = async () => {
    setPolling(true);
    setPollResult(null);
    try {
      const res = await fetch('/api/polls/trigger', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setPollResult('Poll queued — watch status indicator and poll log for result');
        // Refresh history after a delay to catch the result
        setTimeout(() => {
          loadPollHistory();
          fetchCases();
        }, 4000);
      } else {
        setPollResult(`Error: ${data.error || 'poll failed'}`);
      }
    } catch (e) {
      setPollResult(`Error: ${e instanceof Error ? e.message : 'unknown'}`);
    } finally {
      setPolling(false);
      setTimeout(() => setPollResult(null), 8000);
    }
  };

  // Saved filters
  const saveCurrentFilter = () => {
    if (!newFilterName.trim()) return;
    const current: Record<string, string> = {};
    if (status) current.status = status;
    if (intent) current.intent = intent;
    if (urgency) current.urgency = urgency;
    if (search) current.search = search;

    const updated = [...savedFilters, { name: newFilterName.trim(), params: current }];
    setSavedFilters(updated);
    localStorage.setItem(SAVED_FILTERS_KEY, JSON.stringify(updated));
    setNewFilterName('');
    setShowSaveDialog(false);
  };

  const loadFilter = (filter: SavedFilter) => {
    const params = new URLSearchParams(filter.params);
    params.set('page', '1');
    router.push(`/dashboard?${params}`);
  };

  const deleteFilter = (name: string) => {
    const updated = savedFilters.filter((f) => f.name !== name);
    setSavedFilters(updated);
    localStorage.setItem(SAVED_FILTERS_KEY, JSON.stringify(updated));
  };

  return (
    <div className="p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 md:mb-6">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-gray-100">Cases</h1>
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
            onClick={() => setShowPollLog(!showPollLog)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm border rounded-lg transition-colors ${
              showPollLog
                ? 'border-[#185FA5] bg-blue-50 dark:bg-blue-900/20 text-[#185FA5] dark:text-blue-300'
                : 'border-gray-300 dark:border-gray-600 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800'
            }`}
            title="Show poll log"
          >
            <Activity className="w-4 h-4" />
            <span className="hidden sm:inline">Poll Log</span>
          </button>
          <button
            onClick={exportCsv}
            className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:text-gray-200 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            title="Export to CSV"
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Export</span>
          </button>
          <button
            onClick={pollNow}
            disabled={polling}
            className="flex items-center gap-1.5 px-3 py-2 text-sm border border-[#185FA5] text-[#185FA5] dark:border-[#378ADD] dark:text-[#378ADD] rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-50 transition-colors"
            title="Trigger an immediate Gmail poll"
          >
            <Mail className={`w-4 h-4 ${polling ? 'animate-pulse' : ''}`} />
            <span className="hidden sm:inline">{polling ? 'Polling...' : 'Poll Now'}</span>
          </button>
          <button
            onClick={() => fetchCases()}
            className="flex items-center gap-1.5 px-3 py-2 text-sm bg-[#185FA5] text-white rounded-lg hover:bg-[#0C447C] transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {/* Poll result toast */}
      {pollResult && (
        <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200 rounded-lg text-sm">
          {pollResult}
        </div>
      )}

      {/* Poll log panel */}
      {showPollLog && (
        <div className="mb-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-[#185FA5]" />
              <h2 className="font-semibold text-gray-900 dark:text-gray-100 text-sm">Gmail Poll History</h2>
            </div>
            {pollStats && (
              <div className="flex items-center gap-4 text-xs text-gray-600 dark:text-gray-400">
                <span>{pollStats.total_polls} polls / 24h</span>
                <span>{pollStats.messages_found} messages found</span>
                {pollStats.errors > 0 && (
                  <span className="text-red-600 dark:text-red-400">{pollStats.errors} errors</span>
                )}
              </div>
            )}
          </div>
          <div className="overflow-x-auto max-h-80">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-900 text-gray-600 dark:text-gray-400 sticky top-0">
                  <th className="text-left px-4 py-2 font-medium">Started</th>
                  <th className="text-left px-4 py-2 font-medium">Duration</th>
                  <th className="text-right px-4 py-2 font-medium">Found</th>
                  <th className="text-right px-4 py-2 font-medium">Ingested</th>
                  <th className="text-left px-4 py-2 font-medium">Trigger</th>
                  <th className="text-left px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {pollHistory.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-8 text-gray-400">
                      No polls recorded yet. The worker may not be running — check Railway logs.
                    </td>
                  </tr>
                ) : (
                  pollHistory.map((p) => {
                    const trigger = ((p.metadata as { trigger?: string } | null)?.trigger) || 'scheduled';
                    return (
                      <tr key={p.id} className="border-t border-gray-100 dark:border-gray-700">
                        <td className="px-4 py-2 text-gray-700 dark:text-gray-300 whitespace-nowrap">
                          {new Date(p.started_at).toLocaleString()}
                        </td>
                        <td className="px-4 py-2 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                          {p.duration_ms !== null ? `${p.duration_ms}ms` : p.finished_at ? '—' : <span className="text-yellow-600">running...</span>}
                        </td>
                        <td className="px-4 py-2 text-right text-gray-700 dark:text-gray-300">{p.messages_found}</td>
                        <td className="px-4 py-2 text-right text-gray-700 dark:text-gray-300">{p.cases_inserted}</td>
                        <td className="px-4 py-2">
                          <span className={`text-xs px-1.5 py-0.5 rounded ${
                            trigger === 'manual'
                              ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                              : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                          }`}>{trigger}</span>
                        </td>
                        <td className="px-4 py-2">
                          {p.error ? (
                            <span className="text-red-600 dark:text-red-400 truncate max-w-xs inline-block" title={p.error}>
                              ⚠ {p.error.substring(0, 60)}
                            </span>
                          ) : p.finished_at ? (
                            <span className="text-green-600 dark:text-green-400">✓ ok</span>
                          ) : (
                            <span className="text-yellow-600">…</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* New cases notification banner */}
      {newCasesCount > 0 && (
        <button
          onClick={() => { fetchCases(); setNewCasesCount(0); }}
          className="mb-4 w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 border border-blue-300 dark:border-blue-700 rounded-lg text-sm font-medium hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          {newCasesCount} new case{newCasesCount !== 1 ? 's' : ''} available — click to refresh
        </button>
      )}

      {/* Search + Filters */}
      <div className="mb-4 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
          <input
            type="text"
            placeholder="Search by name, email, subject..."
            defaultValue={search}
            onKeyDown={(e) => {
              if (e.key === 'Enter') updateFilter('search', (e.target as HTMLInputElement).value);
            }}
            className="w-full pl-9 pr-4 py-2.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          />
        </div>

        {showFilters && (
          <div className="p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg space-y-3">
            <div className="flex flex-wrap gap-2">
              <select
                value={status}
                onChange={(e) => updateFilter('status', e.target.value)}
                className="flex-1 min-w-[120px] px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-900 rounded-lg text-sm text-gray-900 dark:text-gray-100"
              >
                <option value="">All Statuses</option>
                {STATUSES.filter(Boolean).map((s) => (
                  <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                ))}
              </select>
              <select
                value={intent}
                onChange={(e) => updateFilter('intent', e.target.value)}
                className="flex-1 min-w-[120px] px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-900 rounded-lg text-sm text-gray-900 dark:text-gray-100"
              >
                <option value="">All Intents</option>
                {INTENTS.filter(Boolean).map((i) => (
                  <option key={i} value={i}>{i.replace(/_/g, ' ')}</option>
                ))}
              </select>
              <select
                value={urgency}
                onChange={(e) => updateFilter('urgency', e.target.value)}
                className="flex-1 min-w-[120px] px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-900 rounded-lg text-sm text-gray-900 dark:text-gray-100"
              >
                <option value="">All Urgencies</option>
                {URGENCIES.filter(Boolean).map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </div>

            {/* Saved filters */}
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
              <Bookmark className="w-4 h-4 text-gray-400" />
              <span className="text-xs text-gray-500 dark:text-gray-400">Saved:</span>
              {savedFilters.length === 0 ? (
                <span className="text-xs text-gray-400 dark:text-gray-500">none yet</span>
              ) : (
                savedFilters.map((f) => (
                  <span key={f.name} className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded text-xs text-gray-700 dark:text-gray-200">
                    <button onClick={() => loadFilter(f)} className="hover:underline">{f.name}</button>
                    <button onClick={() => deleteFilter(f.name)} className="text-gray-400 hover:text-red-500">
                      <CloseIcon className="w-3 h-3" />
                    </button>
                  </span>
                ))
              )}
              {!showSaveDialog ? (
                <button
                  onClick={() => setShowSaveDialog(true)}
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline ml-auto"
                >
                  + Save current
                </button>
              ) : (
                <div className="flex items-center gap-1 ml-auto">
                  <input
                    type="text"
                    placeholder="Name..."
                    value={newFilterName}
                    onChange={(e) => setNewFilterName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && saveCurrentFilter()}
                    className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 rounded"
                    autoFocus
                  />
                  <button onClick={saveCurrentFilter} className="text-xs text-blue-600 hover:underline">Save</button>
                  <button onClick={() => { setShowSaveDialog(false); setNewFilterName(''); }} className="text-gray-400">
                    <CloseIcon className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
          <span className="text-sm font-medium text-blue-900 dark:text-blue-200 mr-2">
            {selectedIds.size} selected
          </span>
          <button
            onClick={() => bulkAction('close')}
            disabled={bulkLoading}
            className="flex items-center gap-1 px-3 py-1.5 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            <XIcon className="w-4 h-4" /> Close
          </button>
          <button
            onClick={() => bulkAction('escalate')}
            disabled={bulkLoading}
            className="flex items-center gap-1 px-3 py-1.5 text-sm bg-white dark:bg-gray-800 border border-red-300 dark:border-red-700 text-red-700 dark:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
          >
            <AlertTriangle className="w-4 h-4" /> Escalate
          </button>
          <button
            onClick={() => bulkAction('reclassify')}
            disabled={bulkLoading}
            className="flex items-center gap-1 px-3 py-1.5 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            <RefreshCw className="w-4 h-4" /> Reclassify
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="ml-auto text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700"
          >
            Clear
          </button>
        </div>
      )}

      {/* Desktop Table */}
      <div className="hidden md:block bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
                <th className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={cases.length > 0 && selectedIds.size === cases.length}
                    onChange={toggleAll}
                    className="rounded"
                  />
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">ID</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Customer</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Subject</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Intent</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Urgency</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Received</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-gray-400">Loading...</td>
                </tr>
              ) : cases.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-gray-400">No cases found</td>
                </tr>
              ) : (
                cases.map((c) => (
                  <tr
                    key={c.id}
                    className={`border-b border-gray-100 dark:border-gray-700 hover:bg-blue-50/50 dark:hover:bg-gray-700/50 transition-colors ${
                      selectedIds.has(c.id) ? 'bg-blue-50/30 dark:bg-blue-900/10' : ''
                    }`}
                  >
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(c.id)}
                        onChange={() => toggleOne(c.id)}
                        className="rounded"
                      />
                    </td>
                    <td className="px-4 py-3 font-mono text-gray-500 dark:text-gray-400 cursor-pointer" onClick={() => router.push(`/dashboard/cases/${c.id}`)}>#{c.id}</td>
                    <td className="px-4 py-3 cursor-pointer" onClick={() => router.push(`/dashboard/cases/${c.id}`)}>
                      <div className="font-medium text-gray-900 dark:text-gray-100">{c.customer_name || '—'}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">{c.from_email}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300 max-w-xs truncate cursor-pointer" onClick={() => router.push(`/dashboard/cases/${c.id}`)}>{c.subject || '(no subject)'}</td>
                    <td className="px-4 py-3 cursor-pointer" onClick={() => router.push(`/dashboard/cases/${c.id}`)}><StatusBadge status={c.status} /></td>
                    <td className="px-4 py-3 cursor-pointer" onClick={() => router.push(`/dashboard/cases/${c.id}`)}>{c.intent ? <IntentBadge intent={c.intent} /> : '—'}</td>
                    <td className="px-4 py-3 cursor-pointer" onClick={() => router.push(`/dashboard/cases/${c.id}`)}>{c.urgency_level ? <UrgencyBadge urgency={c.urgency_level} /> : '—'}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap cursor-pointer" onClick={() => router.push(`/dashboard/cases/${c.id}`)}>
                      {new Date(c.received_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
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

      {/* Mobile Card View */}
      <div className="md:hidden space-y-3">
        {loading ? (
          <div className="text-center py-12 text-gray-400">Loading...</div>
        ) : cases.length === 0 ? (
          <div className="text-center py-12 text-gray-400">No cases found</div>
        ) : (
          cases.map((c) => (
            <div key={c.id} className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={selectedIds.has(c.id)}
                onChange={() => toggleOne(c.id)}
                className="mt-5 rounded"
              />
              <Link
                href={`/dashboard/cases/${c.id}`}
                className="flex-1 block bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 active:bg-blue-50 dark:active:bg-gray-700 transition-colors"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 dark:text-gray-100 truncate">{c.customer_name || c.from_email}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">{c.subject || '(no subject)'}</p>
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
            </div>
          ))
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between py-3">
            <p className="text-sm text-gray-500 dark:text-gray-400">Page {page} of {totalPages}</p>
            <div className="flex gap-2">
              <button
                onClick={() => goToPage(page - 1)}
                disabled={page <= 1}
                className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 dark:text-gray-200 rounded-lg disabled:opacity-30"
              >
                Prev
              </button>
              <button
                onClick={() => goToPage(page + 1)}
                disabled={page >= totalPages}
                className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 dark:text-gray-200 rounded-lg disabled:opacity-30"
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
