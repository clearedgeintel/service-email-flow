'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Save, Plus, Trash2, Check, Tag, RefreshCw } from 'lucide-react';

interface PricingItem {
  id: number;
  trade: string;
  service: string;
  keywords: string[];
  price_min: number;
  price_max: number;
  unit: string;
  active: boolean;
}

const SETTING_GROUPS = [
  {
    title: 'Business Information',
    fields: [
      { key: 'business_name', label: 'Business Name', type: 'text' },
      { key: 'business_phone', label: 'Phone Number', type: 'text' },
      { key: 'business_url', label: 'Website URL', type: 'text' },
      { key: 'business_location', label: 'Location', type: 'text' },
      { key: 'owner_email', label: 'Owner Email', type: 'email' },
    ],
  },
  {
    title: 'Technician Contact',
    fields: [
      { key: 'tech_email', label: 'Tech Email', type: 'email' },
      { key: 'tech_phone', label: 'Tech Phone', type: 'text' },
      { key: 'twilio_from_number', label: 'Twilio From Number', type: 'text' },
    ],
  },
  {
    title: 'Booking Links',
    fields: [
      { key: 'calcom_emergency_url', label: 'Emergency Booking URL', type: 'url' },
      { key: 'calcom_service_url', label: 'Service Call Booking URL', type: 'url' },
      { key: 'calcom_estimate_url', label: 'Free Estimate Booking URL', type: 'url' },
    ],
  },
  {
    title: 'Automation Settings',
    fields: [
      { key: 'confidence_threshold', label: 'Confidence Threshold (0-1)', type: 'number' },
      { key: 'followup_delay_1_hours', label: 'First Follow-up Delay (hours)', type: 'number' },
      { key: 'followup_delay_2_hours', label: 'Second Follow-up Delay (hours)', type: 'number' },
      { key: 'max_followups', label: 'Max Follow-ups', type: 'number' },
      { key: 'slack_webhook_url', label: 'Slack Webhook URL', type: 'url' },
    ],
  },
];

export default function SettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [pricing, setPricing] = useState<PricingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [tab, setTab] = useState<'config' | 'pricing'>('config');
  const [resyncing, setResyncing] = useState(false);
  const [resyncResult, setResyncResult] = useState<string | null>(null);

  const resyncLabels = async () => {
    if (!confirm('Resync Gmail labels for all existing cases? This may take a few minutes.')) return;
    setResyncing(true);
    setResyncResult(null);
    try {
      const res = await fetch('/api/admin/resync-labels', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setResyncResult(`Synced ${data.synced} / ${data.total} cases${data.failed > 0 ? ` (${data.failed} failed)` : ''}`);
      } else {
        setResyncResult(`Error: ${data.error || 'unknown'}`);
      }
    } catch (e) {
      setResyncResult(`Error: ${e instanceof Error ? e.message : 'unknown'}`);
    } finally {
      setResyncing(false);
    }
  };

  useEffect(() => {
    Promise.all([
      fetch('/api/settings').then((r) => {
        if (r.status === 401) { router.push('/login'); return null; }
        return r.json();
      }),
      fetch('/api/pricing').then((r) => r.json()),
    ]).then(([settingsData, pricingData]) => {
      if (settingsData) {
        // Flatten JSONB values
        const flat: Record<string, string> = {};
        for (const [k, v] of Object.entries(settingsData.settings || {})) {
          flat[k] = typeof v === 'string' ? v : JSON.stringify(v);
        }
        setSettings(flat);
      }
      setPricing(pricingData?.items || []);
      setLoading(false);
    });
  }, [router]);

  const saveSettings = async () => {
    setSaving(true);
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(settings)) {
      // Coerce booleans ('true'/'false' from toggle state) to real booleans
      if (v === 'true') {
        body[k] = true;
        continue;
      }
      if (v === 'false') {
        body[k] = false;
        continue;
      }
      // Coerce numbers for number-type fields
      const num = parseFloat(v);
      body[k] = !isNaN(num) && SETTING_GROUPS.some(g => g.fields.some(f => f.key === k && f.type === 'number'))
        ? num
        : v;
    }

    await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const deletePricingItem = async (id: number) => {
    await fetch(`/api/pricing/${id}`, { method: 'DELETE' });
    setPricing(pricing.filter((p) => p.id !== id));
  };

  const [newItem, setNewItem] = useState({ trade: 'electric', service: '', keywords: '', price_min: '', price_max: '', unit: 'per job' });
  const [addingPricing, setAddingPricing] = useState(false);

  const addPricingItem = async () => {
    if (!newItem.service || !newItem.keywords || !newItem.price_min || !newItem.price_max) return;
    setAddingPricing(true);
    const res = await fetch('/api/pricing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...newItem,
        keywords: newItem.keywords.split(',').map((k) => k.trim()),
        price_min: parseFloat(newItem.price_min),
        price_max: parseFloat(newItem.price_max),
      }),
    });
    const data = await res.json();
    if (data.item) {
      setPricing([...pricing, data.item]);
      setNewItem({ trade: 'electric', service: '', keywords: '', price_min: '', price_max: '', unit: 'per job' });
    }
    setAddingPricing(false);
  };

  if (loading) {
    return <div className="p-6 text-gray-400">Loading settings...</div>;
  }

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Settings</h1>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-lg w-fit">
        <button
          onClick={() => setTab('config')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab === 'config' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >
          Configuration
        </button>
        <button
          onClick={() => setTab('pricing')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab === 'pricing' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >
          Pricing Table
        </button>
      </div>

      {tab === 'config' && (
        <div className="space-y-6">
          {SETTING_GROUPS.map((group) => (
            <div key={group.title} className="bg-white border border-gray-200 rounded-xl p-5">
              <h2 className="font-semibold text-gray-900 mb-4">{group.title}</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {group.fields.map((field) => (
                  <div key={field.key}>
                    <label className="block text-sm font-medium text-gray-600 mb-1">{field.label}</label>
                    <input
                      type={field.type}
                      value={settings[field.key] || ''}
                      onChange={(e) => setSettings({ ...settings, [field.key]: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-blue-500 outline-none"
                      step={field.type === 'number' ? '0.01' : undefined}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h2 className="font-semibold text-gray-900 mb-4">Reply Mode</h2>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">Auto-send replies</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {settings.auto_reply === 'true'
                    ? 'Replies are sent automatically to customers'
                    : 'Replies are saved as Gmail drafts for your review (emergencies always send immediately)'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSettings({ ...settings, auto_reply: settings.auto_reply === 'true' ? 'false' : 'true' })}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${settings.auto_reply === 'true' ? 'bg-[#185FA5]' : 'bg-gray-300'}`}
              >
                <span className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${settings.auto_reply === 'true' ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-2">
              <Tag className="w-4 h-4 text-gray-600" />
              <h2 className="font-semibold text-gray-900">Gmail Labels</h2>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              Sync ClearDesk labels to all existing cases in Gmail. New cases are labeled automatically;
              this retroactively applies labels to cases that existed before label sync was added
              (and migrates any legacy ServiceFlow/* labels to ClearDesk/*).
            </p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={resyncLabels}
                disabled={resyncing}
                className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                <RefreshCw className={`w-4 h-4 ${resyncing ? 'animate-spin' : ''}`} />
                {resyncing ? 'Syncing...' : 'Resync all labels'}
              </button>
              {resyncResult && (
                <span className="text-sm text-gray-600">{resyncResult}</span>
              )}
            </div>
          </div>

          <button
            onClick={saveSettings}
            disabled={saving}
            className="flex items-center gap-2 px-6 py-2.5 bg-[#185FA5] text-white rounded-lg text-sm font-medium hover:bg-[#0C447C] disabled:opacity-50 transition-colors"
          >
            {saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            {saved ? 'Saved!' : saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      )}

      {tab === 'pricing' && (
        <div className="space-y-6">
          {/* Pricing Table */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Trade</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Service</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Keywords</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Min</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Max</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Unit</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {pricing.filter(p => p.active).map((item) => (
                  <tr key={item.id} className="border-b border-gray-100">
                    <td className="px-4 py-2.5 capitalize">{item.trade}</td>
                    <td className="px-4 py-2.5 font-medium">{item.service}</td>
                    <td className="px-4 py-2.5 text-gray-500 max-w-xs truncate">{item.keywords.join(', ')}</td>
                    <td className="px-4 py-2.5 text-right">${item.price_min}</td>
                    <td className="px-4 py-2.5 text-right">${item.price_max}</td>
                    <td className="px-4 py-2.5">{item.unit}</td>
                    <td className="px-4 py-2.5">
                      <button
                        onClick={() => deletePricingItem(item.id)}
                        className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Add New Item */}
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="font-semibold text-gray-900 mb-3">Add Pricing Item</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <select
                value={newItem.trade}
                onChange={(e) => setNewItem({ ...newItem, trade: e.target.value })}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 placeholder:text-gray-400"
              >
                <option value="electric">Electric</option>
                <option value="plumbing">Plumbing</option>
              </select>
              <input
                placeholder="Service name"
                value={newItem.service}
                onChange={(e) => setNewItem({ ...newItem, service: e.target.value })}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm col-span-2"
              />
              <input
                placeholder="Keywords (comma-separated)"
                value={newItem.keywords}
                onChange={(e) => setNewItem({ ...newItem, keywords: e.target.value })}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm col-span-3 sm:col-span-3"
              />
              <input
                type="number"
                placeholder="Min $"
                value={newItem.price_min}
                onChange={(e) => setNewItem({ ...newItem, price_min: e.target.value })}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 placeholder:text-gray-400"
              />
              <input
                type="number"
                placeholder="Max $"
                value={newItem.price_max}
                onChange={(e) => setNewItem({ ...newItem, price_max: e.target.value })}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 placeholder:text-gray-400"
              />
              <input
                placeholder="Unit (e.g. per job)"
                value={newItem.unit}
                onChange={(e) => setNewItem({ ...newItem, unit: e.target.value })}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 placeholder:text-gray-400"
              />
            </div>
            <button
              onClick={addPricingItem}
              disabled={addingPricing}
              className="mt-3 flex items-center gap-2 px-4 py-2 bg-gray-800 text-white rounded-lg text-sm hover:bg-gray-900 disabled:opacity-50 transition-colors"
            >
              <Plus className="w-4 h-4" />
              {addingPricing ? 'Adding...' : 'Add Item'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
