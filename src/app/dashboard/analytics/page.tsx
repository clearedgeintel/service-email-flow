'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { TrendingUp, Clock, AlertTriangle, Users } from 'lucide-react';

interface Analytics {
  totalCases: number;
  byStatus: Record<string, number>;
  byIntent: Record<string, number>;
  byUrgency: Record<string, number>;
  byDay: Record<string, number>;
  avgResponseMinutes: number | null;
  followupConversionRate: number | null;
  stuckCount: number;
}

const PIE_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899', '#6b7280', '#14b8a6'];

export default function AnalyticsPage() {
  const router = useRouter();
  const [data, setData] = useState<Analytics | null>(null);
  const [range, setRange] = useState('7');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const from = new Date(Date.now() - parseInt(range) * 24 * 60 * 60 * 1000).toISOString();
    setLoading(true);
    fetch(`/api/analytics?from=${from}`)
      .then((res) => {
        if (res.status === 401) { router.push('/login'); return null; }
        return res.json();
      })
      .then((d) => { if (d) setData(d); })
      .finally(() => setLoading(false));
  }, [range, router]);

  if (loading || !data) {
    return <div className="p-6 text-gray-400">Loading analytics...</div>;
  }

  const dayData = Object.entries(data.byDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, count]) => ({ day: day.substring(5), count }));

  const intentData = Object.entries(data.byIntent).map(([name, value]) => ({ name: name.replace(/_/g, ' '), value }));

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
        <select
          value={range}
          onChange={(e) => setRange(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
        >
          <option value="7">Last 7 days</option>
          <option value="14">Last 14 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </select>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard icon={TrendingUp} label="Total Cases" value={String(data.totalCases)} color="blue" />
        <StatCard
          icon={Clock}
          label="Avg Response Time"
          value={data.avgResponseMinutes !== null ? `${data.avgResponseMinutes}m` : '—'}
          color="green"
        />
        <StatCard icon={AlertTriangle} label="Stuck Items" value={String(data.stuckCount)} color="red" />
        <StatCard
          icon={Users}
          label="Follow-up Conversion"
          value={data.followupConversionRate !== null ? `${data.followupConversionRate}%` : '—'}
          color="purple"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Volume Chart */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="font-semibold text-gray-900 mb-4">Daily Volume</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dayData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="day" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Intent Distribution */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="font-semibold text-gray-900 mb-4">Intent Distribution</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={intentData}
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  dataKey="value"
                  label={(props: any) => `${props.name || ''} ${((props.percent ?? 0) * 100).toFixed(0)}%`}
                  labelLine={false}
                >
                  {intentData.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Status Breakdown */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="font-semibold text-gray-900 mb-4">By Status</h2>
          <div className="space-y-2">
            {Object.entries(data.byStatus).map(([status, count]) => (
              <div key={status} className="flex items-center justify-between text-sm">
                <span className="text-gray-600">{status.replace(/_/g, ' ')}</span>
                <div className="flex items-center gap-2">
                  <div className="w-24 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full"
                      style={{ width: `${(count / data.totalCases) * 100}%` }}
                    />
                  </div>
                  <span className="font-medium text-gray-800 w-8 text-right">{count}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Urgency Breakdown */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="font-semibold text-gray-900 mb-4">By Urgency</h2>
          <div className="space-y-2">
            {Object.entries(data.byUrgency).map(([urgency, count]) => {
              const colors: Record<string, string> = {
                EMERGENCY: 'bg-red-500',
                TODAY: 'bg-orange-500',
                THIS_WEEK: 'bg-yellow-500',
                ROUTINE: 'bg-green-500',
              };
              return (
                <div key={urgency} className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">{urgency}</span>
                  <div className="flex items-center gap-2">
                    <div className="w-24 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${colors[urgency] || 'bg-gray-400'}`}
                        style={{ width: `${(count / data.totalCases) * 100}%` }}
                      />
                    </div>
                    <span className="font-medium text-gray-800 w-8 text-right">{count}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color }: {
  icon: React.ElementType;
  label: string;
  value: string;
  color: 'blue' | 'green' | 'red' | 'purple';
}) {
  const iconColors = {
    blue: 'bg-blue-100 text-blue-600',
    green: 'bg-green-100 text-green-600',
    red: 'bg-red-100 text-red-600',
    purple: 'bg-purple-100 text-purple-600',
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${iconColors[color]}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <p className="text-xs text-gray-500">{label}</p>
          <p className="text-2xl font-bold text-gray-900">{value}</p>
        </div>
      </div>
    </div>
  );
}
