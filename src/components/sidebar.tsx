'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { clsx } from 'clsx';
import { Inbox, BarChart3, Settings, LogOut, Menu, X, Mail, Circle, Moon, Sun, PhoneCall, Calendar } from 'lucide-react';

const THEME_KEY = 'cleardesk:theme';

function useTheme() {
  const [theme, setThemeState] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const stored = localStorage.getItem(THEME_KEY) || localStorage.getItem('serviceflow:theme');
    const isDark = stored === 'dark' || (!stored && window.matchMedia('(prefers-color-scheme: dark)').matches);
    setThemeState(isDark ? 'dark' : 'light');
  }, []);

  const setTheme = (next: 'light' | 'dark') => {
    setThemeState(next);
    localStorage.setItem(THEME_KEY, next);
    document.documentElement.classList.toggle('dark', next === 'dark');
  };

  return { theme, setTheme };
}

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Cases', icon: Inbox },
  { href: '/dashboard/calls', label: 'Calls', icon: PhoneCall },
  { href: '/dashboard/calendar', label: 'Calendar', icon: Calendar },
  { href: '/dashboard/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/dashboard/settings', label: 'Settings', icon: Settings },
];

/** Compact ClearDesk icon (signal arcs in rounded navy square) */
function BrandIcon({ className = 'w-6 h-6' }: { className?: string }) {
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

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mailbox, setMailbox] = useState<string>('');
  const [systemStatus, setSystemStatus] = useState<'loading' | 'connected' | 'error'>('loading');
  const [workerStatus, setWorkerStatus] = useState<'running' | 'stale' | 'unknown'>('unknown');
  const [lastPoll, setLastPoll] = useState<{
    started_at: string;
    messages_found: number;
    cases_inserted: number;
    error: string | null;
  } | null>(null);
  const { theme, setTheme } = useTheme();

  const refreshStatus = () => {
    fetch('/api/mailbox-status')
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data) {
          setMailbox(data.mailbox || '');
          setSystemStatus(data.healthy ? 'connected' : 'error');
          setWorkerStatus(data.worker_status || 'unknown');
          setLastPoll(data.last_poll || null);
        }
      })
      .catch(() => setSystemStatus('error'));
  };

  useEffect(() => {
    refreshStatus();
    const interval = setInterval(refreshStatus, 30_000);
    return () => clearInterval(interval);
  }, []);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  };

  const formatAgo = (iso: string | undefined | null) => {
    if (!iso) return 'never';
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  const statusIndicator = (
    <div className="px-4 py-3 border-t border-white/10">
      <div className="flex items-center gap-2">
        <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        <span className="text-xs text-slate-400">Monitoring Inbox</span>
      </div>
      <div className="flex items-center gap-1.5 mt-1.5 ml-[22px]">
        <Circle
          className={clsx(
            'w-2 h-2 shrink-0',
            systemStatus === 'connected' && workerStatus === 'running' && 'text-green-400 fill-green-400',
            systemStatus === 'connected' && workerStatus === 'stale' && 'text-yellow-400 fill-yellow-400',
            systemStatus === 'connected' && workerStatus === 'unknown' && 'text-yellow-400 fill-yellow-400',
            systemStatus === 'error' && 'text-red-400 fill-red-400',
            systemStatus === 'loading' && 'text-yellow-400 fill-yellow-400',
          )}
        />
        <span className="text-xs text-slate-300 truncate">
          {mailbox || 'Not configured'}
        </span>
      </div>
      <p className="text-[10px] text-slate-500 mt-1 ml-[22px]">
        {systemStatus === 'error'
          ? 'Connection issue'
          : workerStatus === 'running'
            ? `Last poll ${formatAgo(lastPoll?.started_at)}`
            : workerStatus === 'stale'
              ? `Worker stale — last poll ${formatAgo(lastPoll?.started_at)}`
              : 'Worker not running'}
      </p>
      {lastPoll && !lastPoll.error && workerStatus === 'running' && (
        <p className="text-[10px] text-slate-500 mt-0.5 ml-[22px]">
          Found {lastPoll.messages_found} · ingested {lastPoll.cases_inserted}
        </p>
      )}
      {lastPoll?.error && (
        <p className="text-[10px] text-red-300 mt-0.5 ml-[22px] truncate" title={lastPoll.error}>
          Error: {lastPoll.error}
        </p>
      )}
    </div>
  );

  const navContent = (
    <>
      <div className="p-6 border-b border-white/10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <BrandIcon className="w-8 h-8 shrink-0" />
            <div>
              <h1 className="text-lg font-semibold leading-tight">
                <span className="text-[#378ADD]">Clear</span><span className="text-white">Desk</span>
              </h1>
              <p className="text-[10px] text-slate-400 tracking-wider uppercase mt-0.5">by ClearEdge</p>
            </div>
          </div>
          <button onClick={() => setOpen(false)} className="md:hidden p-1 text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      <nav className="flex-1 p-4 space-y-1">
        {NAV_ITEMS.map((item) => {
          const isActive =
            item.href === '/dashboard'
              ? pathname === '/dashboard' || pathname.startsWith('/dashboard/cases')
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className={clsx(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors',
                isActive
                  ? 'bg-[#185FA5] text-white'
                  : 'text-slate-300 hover:bg-white/5 hover:text-white',
              )}
            >
              <item.icon className="w-4 h-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {statusIndicator}

      <div className="p-4 border-t border-white/10 space-y-1">
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-slate-300 hover:bg-white/5 hover:text-white w-full transition-colors"
        >
          {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
        </button>
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-slate-300 hover:bg-white/5 hover:text-white w-full transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Sign Out
        </button>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile header bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 bg-[#0B1A2E] text-white flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <BrandIcon className="w-6 h-6" />
          <span className="font-semibold">
            <span className="text-[#378ADD]">Clear</span>Desk
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Circle
              className={clsx(
                'w-2 h-2',
                systemStatus === 'connected' && 'text-green-400 fill-green-400',
                systemStatus === 'error' && 'text-red-400 fill-red-400',
                systemStatus === 'loading' && 'text-yellow-400 fill-yellow-400',
              )}
            />
            <span className="text-xs text-slate-400 max-w-[120px] truncate">{mailbox || '—'}</span>
          </div>
          <button onClick={() => setOpen(true)} className="p-1.5 rounded-lg hover:bg-white/5">
            <Menu className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Mobile overlay */}
      {open && (
        <div className="md:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-64 bg-[#0B1A2E] text-white flex flex-col">
            {navContent}
          </aside>
        </div>
      )}

      {/* Desktop sidebar — deep navy with subtle gradient */}
      <aside className="hidden md:flex w-64 bg-gradient-to-b from-[#0B1A2E] via-[#0C447C]/20 to-[#0B1A2E] text-white flex-col h-screen sticky top-0">
        {navContent}
      </aside>
    </>
  );
}
