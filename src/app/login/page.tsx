'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

function BrandIcon({ className = 'w-12 h-12' }: { className?: string }) {
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

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // Empty email field → server falls back to the ADMIN_PASSWORD
      // bootstrap (legacy single-admin path). Once a real user exists,
      // future logins should fill in the email.
      const body: Record<string, string> = { password };
      if (email.trim()) body.email = email.trim();

      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        router.push('/dashboard');
      } else {
        const data = await res.json();
        setError(data.error || 'Login failed');
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-[#0B1A2E] via-[#0C447C] to-[#0B1A2E] relative overflow-hidden">
      {/* Radial accent */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(55,138,221,0.15),_transparent_50%)] pointer-events-none" />

      <div className="w-full max-w-sm relative z-10">
        <div className="text-center mb-8">
          <div className="inline-flex flex-col items-center gap-3 mb-3">
            <BrandIcon className="w-14 h-14" />
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">
                <span className="text-[#378ADD]">Clear</span><span className="text-white">Desk</span>
              </h1>
              <p className="text-[11px] text-slate-400 tracking-[0.2em] uppercase mt-1">
                by ClearEdge Intelligence
              </p>
            </div>
          </div>
          <p className="text-slate-300 text-sm mt-4">AI Email Automation for Service Businesses</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white dark:bg-[#112240] rounded-xl shadow-xl border border-slate-200 dark:border-white/10 p-6 space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">
              Email <span className="text-xs text-slate-400 font-normal">(blank for bootstrap)</span>
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2.5 border border-slate-300 dark:border-white/10 dark:bg-[#0B1A2E] dark:text-slate-100 rounded-lg text-sm focus:ring-2 focus:ring-[#185FA5] focus:border-[#185FA5] outline-none"
              placeholder="you@company.com"
              autoFocus
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2.5 border border-slate-300 dark:border-white/10 dark:bg-[#0B1A2E] dark:text-slate-100 rounded-lg text-sm focus:ring-2 focus:ring-[#185FA5] focus:border-[#185FA5] outline-none"
              placeholder="Enter password"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !password}
            className="w-full bg-[#185FA5] text-white py-2.5 px-4 rounded-lg text-sm font-medium hover:bg-[#0C447C] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p className="text-center text-xs text-slate-400 mt-6">
          Need help? Contact your ClearEdge support team.
        </p>
      </div>
    </div>
  );
}
