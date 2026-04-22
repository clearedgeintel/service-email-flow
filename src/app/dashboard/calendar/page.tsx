'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, RefreshCw, Mail } from 'lucide-react';

interface CalendarEvent {
  id: string;
  provider: string;
  title: string;
  start: string;
  end: string;
  href?: string;
  caseId?: number;
  status?: string;
}

interface FreeSlot {
  provider: string;
  start: string;
  end: string;
  bookingUrl?: string;
}

interface ApiResponse {
  providers: Array<{ id: string; label: string }>;
  events: CalendarEvent[];
  slots: FreeSlot[];
}

const HOUR_HEIGHT_PX = 48; // one hour = 48px tall
const START_HOUR = 6;      // render from 6am
const END_HOUR = 22;       // to 10pm (16 rows)

function startOfWeek(d: Date): Date {
  const day = d.getDay(); // 0 = Sunday
  const diff = d.getDate() - day;
  const sunday = new Date(d);
  sunday.setDate(diff);
  sunday.setHours(0, 0, 0, 0);
  return sunday;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function minutesFromStart(iso: string): number {
  const d = new Date(iso);
  return (d.getHours() - START_HOUR) * 60 + d.getMinutes();
}

function durationMinutes(start: string, end: string): number {
  return Math.max(15, (new Date(end).getTime() - new Date(start).getTime()) / 60_000);
}

export default function CalendarPage() {
  const router = useRouter();
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSlots, setShowSlots] = useState(true);

  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart]);

  const fetchCalendar = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        from: weekStart.toISOString(),
        to: weekEnd.toISOString(),
        include_slots: String(showSlots),
      });
      const res = await fetch(`/api/calendar?${params}`);
      if (res.status === 401) { router.push('/login'); return; }
      if (res.ok) {
        const body = (await res.json()) as ApiResponse;
        setData(body);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchCalendar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [weekStart, showSlots]);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  return (
    <div className="p-4 md:p-6">
      <div className="flex items-center justify-between mb-4 md:mb-6 gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <CalendarIcon className="w-6 h-6 text-[#185FA5]" />
          <h1 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-gray-100">Calendar</h1>
          {data && (
            <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">
              {data.providers.map((p) => p.label).join(' · ')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setWeekStart(startOfWeek(new Date()))}
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300"
          >
            Today
          </button>
          <button
            onClick={() => setWeekStart(addDays(weekStart, -7))}
            className="p-1.5 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800"
            aria-label="Previous week"
          >
            <ChevronLeft className="w-4 h-4 dark:text-gray-300" />
          </button>
          <button
            onClick={() => setWeekStart(addDays(weekStart, 7))}
            className="p-1.5 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800"
            aria-label="Next week"
          >
            <ChevronRight className="w-4 h-4 dark:text-gray-300" />
          </button>
          <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400 ml-2">
            <input
              type="checkbox"
              checked={showSlots}
              onChange={(e) => setShowSlots(e.target.checked)}
              className="rounded"
            />
            Show available slots
          </label>
          <button
            onClick={fetchCalendar}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-[#185FA5] text-white rounded-lg hover:bg-[#0C447C] disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
        Week of {weekStart.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
      </p>

      {!data ? (
        <div className="text-center py-12 text-gray-400 dark:text-gray-500">
          {loading ? 'Loading calendar...' : 'No calendar data'}
        </div>
      ) : data.providers.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-8 text-center">
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-2">No calendar providers configured.</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Connect Cal.com in <Link href="/dashboard/settings" className="text-[#185FA5] hover:underline">Settings</Link> to see bookings and open slots here.
          </p>
        </div>
      ) : (
        <WeekGrid
          days={days}
          events={data.events}
          slots={showSlots ? data.slots : []}
        />
      )}
    </div>
  );
}

function WeekGrid({ days, events, slots }: { days: Date[]; events: CalendarEvent[]; slots: FreeSlot[] }) {
  const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <div className="min-w-[900px]">
          {/* Header row — day labels */}
          <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
            <div className="p-2 text-xs text-gray-400 dark:text-gray-500"></div>
            {days.map((d) => {
              const isToday = sameDay(d, new Date());
              return (
                <div
                  key={d.toISOString()}
                  className={`p-2 text-center border-l border-gray-200 dark:border-gray-700 ${isToday ? 'bg-blue-50 dark:bg-blue-950/30' : ''}`}
                >
                  <div className="text-[11px] uppercase text-gray-500 dark:text-gray-400">
                    {d.toLocaleDateString('en-US', { weekday: 'short' })}
                  </div>
                  <div className={`text-sm font-semibold ${isToday ? 'text-[#185FA5] dark:text-[#378ADD]' : 'text-gray-700 dark:text-gray-300'}`}>
                    {d.getDate()}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Body — hour rows × 7 day columns */}
          <div className="grid grid-cols-[60px_repeat(7,1fr)] relative">
            {/* Left rail: hour labels */}
            <div className="border-r border-gray-200 dark:border-gray-700">
              {hours.map((h) => (
                <div
                  key={h}
                  style={{ height: HOUR_HEIGHT_PX }}
                  className="px-1.5 text-[10px] text-gray-400 dark:text-gray-500 text-right relative"
                >
                  <span className="absolute top-0 right-1.5 -translate-y-1/2">
                    {h === 12 ? '12pm' : h > 12 ? `${h - 12}pm` : `${h}am`}
                  </span>
                </div>
              ))}
            </div>

            {/* Day columns */}
            {days.map((d) => {
              const dayEvents = events.filter((e) => sameDay(new Date(e.start), d));
              const daySlots = slots.filter((s) => sameDay(new Date(s.start), d));
              const isToday = sameDay(d, new Date());

              return (
                <div
                  key={d.toISOString()}
                  className={`relative border-l border-gray-200 dark:border-gray-700 ${isToday ? 'bg-blue-50/40 dark:bg-blue-950/20' : ''}`}
                >
                  {/* Hour grid lines */}
                  {hours.map((h) => (
                    <div
                      key={h}
                      style={{ height: HOUR_HEIGHT_PX }}
                      className="border-b border-gray-100 dark:border-gray-700/50"
                    />
                  ))}

                  {/* Free-slot markers (faint, behind events) */}
                  {daySlots.map((s, i) => {
                    const top = (minutesFromStart(s.start) / 60) * HOUR_HEIGHT_PX;
                    const height = (durationMinutes(s.start, s.end) / 60) * HOUR_HEIGHT_PX;
                    if (top < 0 || top + height < 0) return null;
                    const body = (
                      <div className="text-[10px] text-emerald-700 dark:text-emerald-300 truncate">
                        {new Date(s.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                      </div>
                    );
                    return s.bookingUrl ? (
                      <a
                        key={i}
                        href={s.bookingUrl}
                        target="_blank"
                        rel="noreferrer"
                        title="Open in Cal.com"
                        style={{ top, height: Math.max(18, height) }}
                        className="absolute left-0.5 right-0.5 border border-dashed border-emerald-300 dark:border-emerald-700 bg-emerald-50/50 dark:bg-emerald-900/20 rounded px-1 py-0.5 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors"
                      >
                        {body}
                      </a>
                    ) : (
                      <div
                        key={i}
                        style={{ top, height: Math.max(18, height) }}
                        className="absolute left-0.5 right-0.5 border border-dashed border-emerald-300 dark:border-emerald-700 bg-emerald-50/50 dark:bg-emerald-900/20 rounded px-1 py-0.5"
                      >
                        {body}
                      </div>
                    );
                  })}

                  {/* Events (solid blocks, on top) */}
                  {dayEvents.map((e) => {
                    const top = (minutesFromStart(e.start) / 60) * HOUR_HEIGHT_PX;
                    const height = (durationMinutes(e.start, e.end) / 60) * HOUR_HEIGHT_PX;
                    if (top + height < 0) return null;
                    const colors = providerColors(e.provider, e.status);
                    const Icon = providerIcon(e.provider);
                    const body = (
                      <div className="px-1.5 py-1 text-[11px] leading-tight overflow-hidden h-full">
                        <div className="flex items-center gap-1 font-medium truncate">
                          <Icon className="w-3 h-3 shrink-0" />
                          <span className="truncate">{e.title}</span>
                        </div>
                        <div className="text-[10px] opacity-70">
                          {new Date(e.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                        </div>
                      </div>
                    );
                    return e.href ? (
                      <Link
                        key={e.id}
                        href={e.href}
                        style={{ top, height: Math.max(22, height) }}
                        className={`absolute left-0.5 right-0.5 rounded border z-10 ${colors.block}`}
                      >
                        {body}
                      </Link>
                    ) : (
                      <div
                        key={e.id}
                        style={{ top, height: Math.max(22, height) }}
                        className={`absolute left-0.5 right-0.5 rounded border z-10 ${colors.block}`}
                      >
                        {body}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-end gap-4 text-[11px] text-gray-500 dark:text-gray-400 px-3 py-2 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 flex-wrap">
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded border bg-blue-100 border-blue-300 dark:bg-blue-900/50 dark:border-blue-700" /> ClearDesk booking</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded border bg-violet-100 border-violet-300 dark:bg-violet-900/50 dark:border-violet-700" /> Cal.com booking</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded border border-dashed bg-emerald-50/50 border-emerald-300 dark:bg-emerald-900/20 dark:border-emerald-700" /> Available slot</span>
      </div>
    </div>
  );
}

function providerColors(provider: string, status?: string): { block: string } {
  if (status === 'cancelled') {
    return { block: 'bg-red-50 dark:bg-red-950/40 border-red-300 dark:border-red-800 text-red-800 dark:text-red-200 line-through' };
  }
  if (status === 'completed') {
    return { block: 'bg-slate-100 dark:bg-slate-700 border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300' };
  }
  switch (provider) {
    case 'cleardesk':
      return { block: 'bg-blue-100 dark:bg-blue-900/50 border-blue-300 dark:border-blue-700 text-blue-900 dark:text-blue-100 hover:bg-blue-200 dark:hover:bg-blue-900/70' };
    case 'calcom':
      return { block: 'bg-violet-100 dark:bg-violet-900/50 border-violet-300 dark:border-violet-700 text-violet-900 dark:text-violet-100 hover:bg-violet-200 dark:hover:bg-violet-900/70' };
    case 'google':
      return { block: 'bg-yellow-100 dark:bg-yellow-900/40 border-yellow-300 dark:border-yellow-700 text-yellow-900 dark:text-yellow-100' };
    case 'calendly':
      return { block: 'bg-pink-100 dark:bg-pink-900/50 border-pink-300 dark:border-pink-700 text-pink-900 dark:text-pink-100' };
    default:
      return { block: 'bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-800 dark:text-gray-200' };
  }
}

function providerIcon(provider: string) {
  switch (provider) {
    case 'cleardesk': return Mail;
    case 'calcom':    return CalendarIcon;
    case 'calendly':  return CalendarIcon;
    case 'google':    return CalendarIcon;
    default:          return CalendarIcon;
  }
}

