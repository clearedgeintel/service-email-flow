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
  {
    title: 'Smart Scheduling (Cal.com Slots)',
    fields: [
      { key: 'calcom_api_key', label: 'Cal.com API Key', type: 'password' },
      { key: 'calcom_event_type_emergency', label: 'Emergency Event Type ID', type: 'number' },
      { key: 'calcom_event_type_service', label: 'Service Call Event Type ID', type: 'number' },
      { key: 'calcom_event_type_estimate', label: 'Estimate Event Type ID', type: 'number' },
      { key: 'business_timezone', label: 'Business Timezone (IANA)', type: 'text' },
      { key: 'slot_suggestion_days', label: 'Days of availability to query', type: 'number' },
      { key: 'slot_suggestion_count', label: 'Slots to show in email (1-5)', type: 'number' },
    ],
  },
  {
    title: 'Retell AI Voice Agent',
    fields: [
      { key: 'retell_api_key', label: 'Retell API Key', type: 'password' },
      { key: 'retell_inbound_agent_id', label: 'Inbound Agent ID', type: 'text' },
      { key: 'retell_outbound_agent_id', label: 'Outbound Agent ID', type: 'text' },
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
  const [tab, setTab] = useState<'config' | 'pricing' | 'templates' | 'webhooks'>('config');
  const [webhooks, setWebhooks] = useState<Array<{
    id: number;
    name: string;
    url: string;
    secret: string;
    events: string[];
    active: boolean;
    description: string | null;
    created_at: string;
  }>>([]);
  const [availableEvents, setAvailableEvents] = useState<string[]>([]);
  const [newWebhook, setNewWebhook] = useState<{ name: string; url: string; events: string[]; description: string }>({ name: '', url: '', events: [], description: '' });
  const [webhookTestResult, setWebhookTestResult] = useState<Record<number, string>>({});
  const [revealedSecrets, setRevealedSecrets] = useState<Record<number, boolean>>({});
  const [templates, setTemplates] = useState<Array<{
    key: string;
    label: string;
    description: string | null;
    subject: string | null;
    body: string;
    body_format: string;
    variables: string[];
    updated_at: string;
  }>>([]);
  const [editingTemplate, setEditingTemplate] = useState<string | null>(null);
  const [templateDrafts, setTemplateDrafts] = useState<Record<string, { subject: string; body: string }>>({});
  const [templateSaving, setTemplateSaving] = useState<string | null>(null);
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
      fetch('/api/templates').then((r) => r.ok ? r.json() : { templates: [] }),
      fetch('/api/webhooks').then((r) => r.ok ? r.json() : { subscriptions: [], available_events: [] }),
    ]).then(([settingsData, pricingData, templatesData, webhooksData]) => {
      if (settingsData) {
        // Flatten JSONB values
        const flat: Record<string, string> = {};
        for (const [k, v] of Object.entries(settingsData.settings || {})) {
          flat[k] = typeof v === 'string' ? v : JSON.stringify(v);
        }
        setSettings(flat);
      }
      setPricing(pricingData?.items || []);
      setTemplates(templatesData?.templates || []);
      setWebhooks(webhooksData?.subscriptions || []);
      setAvailableEvents(webhooksData?.available_events || []);
      setLoading(false);
    });
  }, [router]);

  const createWebhook = async () => {
    if (!newWebhook.name || !newWebhook.url || newWebhook.events.length === 0) return;
    const res = await fetch('/api/webhooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newWebhook),
    });
    if (res.ok) {
      const data = await res.json();
      setWebhooks([data.subscription, ...webhooks]);
      setNewWebhook({ name: '', url: '', events: [], description: '' });
      setRevealedSecrets({ ...revealedSecrets, [data.subscription.id]: true });
    }
  };

  const toggleWebhookActive = async (id: number, active: boolean) => {
    const res = await fetch(`/api/webhooks/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active }),
    });
    if (res.ok) {
      const data = await res.json();
      setWebhooks(webhooks.map((w) => (w.id === id ? data.subscription : w)));
    }
  };

  const deleteWebhook = async (id: number) => {
    if (!confirm('Delete this webhook? Any queued deliveries will be lost.')) return;
    const res = await fetch(`/api/webhooks/${id}`, { method: 'DELETE' });
    if (res.ok) setWebhooks(webhooks.filter((w) => w.id !== id));
  };

  const testWebhook = async (id: number) => {
    setWebhookTestResult({ ...webhookTestResult, [id]: 'Sending...' });
    const res = await fetch(`/api/webhooks/${id}/test`, { method: 'POST' });
    const data = await res.json();
    setWebhookTestResult({
      ...webhookTestResult,
      [id]: res.ok ? `✓ ${data.message || 'Test queued'}` : `✗ ${data.error || 'Failed'}`,
    });
    setTimeout(() => {
      setWebhookTestResult((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }, 6000);
  };

  const saveTemplate = async (key: string) => {
    const draft = templateDrafts[key];
    if (!draft) return;
    setTemplateSaving(key);
    try {
      const res = await fetch(`/api/templates/${key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: draft.subject || null, body: draft.body }),
      });
      if (res.ok) {
        const data = await res.json();
        setTemplates((prev) => prev.map((t) => (t.key === key ? data.template : t)));
        setEditingTemplate(null);
        setTemplateDrafts((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }
    } finally {
      setTemplateSaving(null);
    }
  };

  const startEditingTemplate = (key: string, subject: string | null, body: string) => {
    setEditingTemplate(key);
    setTemplateDrafts({ ...templateDrafts, [key]: { subject: subject || '', body } });
  };

  const cancelEditingTemplate = (key: string) => {
    setEditingTemplate(null);
    setTemplateDrafts((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

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
        <button
          onClick={() => setTab('templates')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab === 'templates' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >
          Email Templates
        </button>
        <button
          onClick={() => setTab('webhooks')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab === 'webhooks' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >
          Webhooks
        </button>
      </div>

      {tab === 'webhooks' && (
        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-900">
            <p className="font-medium mb-1">Outbound webhooks</p>
            <p className="text-blue-800">
              ClearDesk sends signed HTTP POSTs to your endpoints when case events happen.
              Use this to connect Zapier, n8n, CRMs, or any custom service. Each webhook
              gets a unique secret — verify the <code className="bg-blue-100 px-1 rounded">X-ClearDesk-Signature-256</code>
              header (HMAC-SHA256 of the raw body) on your end.
            </p>
          </div>

          {/* Create new */}
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="font-semibold text-gray-900 mb-3">Add Webhook</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="text"
                placeholder="Name (e.g. Zapier - New cases)"
                value={newWebhook.name}
                onChange={(e) => setNewWebhook({ ...newWebhook, name: e.target.value })}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 placeholder:text-gray-400"
              />
              <input
                type="url"
                placeholder="https://hooks.example.com/..."
                value={newWebhook.url}
                onChange={(e) => setNewWebhook({ ...newWebhook, url: e.target.value })}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 placeholder:text-gray-400"
              />
              <input
                type="text"
                placeholder="Description (optional)"
                value={newWebhook.description}
                onChange={(e) => setNewWebhook({ ...newWebhook, description: e.target.value })}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 placeholder:text-gray-400 col-span-full"
              />
            </div>
            <div className="mt-3">
              <p className="text-xs font-medium text-gray-600 mb-2">Events to subscribe to:</p>
              <div className="flex flex-wrap gap-2">
                {availableEvents.map((ev) => (
                  <label key={ev} className="flex items-center gap-1.5 text-xs border border-gray-200 rounded-lg px-2 py-1 cursor-pointer hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={newWebhook.events.includes(ev)}
                      onChange={(e) => {
                        const events = e.target.checked
                          ? [...newWebhook.events, ev]
                          : newWebhook.events.filter((x) => x !== ev);
                        setNewWebhook({ ...newWebhook, events });
                      }}
                    />
                    <code className="font-mono">{ev}</code>
                  </label>
                ))}
              </div>
            </div>
            <button
              onClick={createWebhook}
              disabled={!newWebhook.name || !newWebhook.url || newWebhook.events.length === 0}
              className="mt-4 px-4 py-2 bg-[#185FA5] text-white rounded-lg text-sm font-medium hover:bg-[#0C447C] disabled:opacity-50"
            >
              Create webhook
            </button>
          </div>

          {/* Existing webhooks */}
          {webhooks.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-xl p-6 text-center text-gray-500 text-sm">
              No webhooks configured yet.
            </div>
          ) : (
            webhooks.map((w) => (
              <div key={w.id} className={`bg-white border rounded-xl p-5 ${w.active ? 'border-gray-200' : 'border-gray-200 opacity-60'}`}>
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-gray-900">{w.name}</h3>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${w.active ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-gray-100 text-gray-600 border border-gray-200'}`}>
                        {w.active ? 'active' : 'disabled'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5 break-all">{w.url}</p>
                    {w.description && <p className="text-xs text-gray-500 mt-1">{w.description}</p>}
                  </div>
                  <div className="flex gap-1 ml-2 shrink-0">
                    <button
                      onClick={() => testWebhook(w.id)}
                      className="px-2 py-1 text-xs border border-gray-300 text-gray-700 rounded hover:bg-gray-50"
                    >
                      Test
                    </button>
                    <button
                      onClick={() => toggleWebhookActive(w.id, !w.active)}
                      className="px-2 py-1 text-xs border border-gray-300 text-gray-700 rounded hover:bg-gray-50"
                    >
                      {w.active ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      onClick={() => deleteWebhook(w.id)}
                      className="px-2 py-1 text-xs border border-red-200 text-red-700 rounded hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1 mt-2">
                  {w.events.map((ev) => (
                    <code key={ev} className="bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded text-[11px] font-mono">{ev}</code>
                  ))}
                </div>

                <div className="mt-3 text-xs">
                  <button
                    onClick={() => setRevealedSecrets({ ...revealedSecrets, [w.id]: !revealedSecrets[w.id] })}
                    className="text-gray-500 hover:text-gray-700 underline"
                  >
                    {revealedSecrets[w.id] ? 'Hide' : 'Show'} signing secret
                  </button>
                  {revealedSecrets[w.id] && (
                    <code className="block mt-1 p-2 bg-gray-50 border border-gray-200 rounded font-mono text-[11px] text-gray-700 break-all">
                      {w.secret}
                    </code>
                  )}
                </div>

                {webhookTestResult[w.id] && (
                  <p className="mt-2 text-xs text-gray-600">{webhookTestResult[w.id]}</p>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'templates' && (
        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-900">
            <p className="font-medium mb-1">How templates work</p>
            <p className="text-blue-800">
              These templates control the AI reply prompt, follow-up emails, and fallback replies.
              Use <code className="bg-blue-100 px-1 rounded text-xs">{'{{variable_name}}'}</code> syntax
              to insert dynamic values (customer name, business info, etc). Changes take effect within 60 seconds.
            </p>
          </div>

          {templates.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-xl p-6 text-center text-gray-500 text-sm">
              No templates found. Run migration 010 in Supabase to seed defaults.
            </div>
          ) : (
            templates.map((t) => {
              const isEditing = editingTemplate === t.key;
              const draft = templateDrafts[t.key];
              return (
                <div key={t.key} className="bg-white border border-gray-200 rounded-xl p-5">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <h3 className="font-semibold text-gray-900">{t.label}</h3>
                      {t.description && (
                        <p className="text-xs text-gray-500 mt-1">{t.description}</p>
                      )}
                    </div>
                    {!isEditing && (
                      <button
                        onClick={() => startEditingTemplate(t.key, t.subject, t.body)}
                        className="ml-2 px-3 py-1.5 text-xs border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
                      >
                        Edit
                      </button>
                    )}
                  </div>

                  {t.variables.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-3">
                      {t.variables.map((v) => (
                        <code key={v} className="bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded text-xs font-mono">
                          {'{{' + v + '}}'}
                        </code>
                      ))}
                    </div>
                  )}

                  {isEditing && draft ? (
                    <div className="space-y-3">
                      {t.subject !== null && (
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Subject</label>
                          <input
                            type="text"
                            value={draft.subject}
                            onChange={(e) => setTemplateDrafts({ ...templateDrafts, [t.key]: { ...draft, subject: e.target.value } })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 focus:ring-2 focus:ring-[#185FA5] outline-none"
                          />
                        </div>
                      )}
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          Body {t.body_format === 'system_prompt' ? '(LLM system prompt)' : ''}
                        </label>
                        <textarea
                          value={draft.body}
                          onChange={(e) => setTemplateDrafts({ ...templateDrafts, [t.key]: { ...draft, body: e.target.value } })}
                          rows={12}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 font-mono focus:ring-2 focus:ring-[#185FA5] outline-none"
                        />
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => saveTemplate(t.key)}
                          disabled={templateSaving === t.key}
                          className="px-4 py-2 bg-[#185FA5] text-white rounded-lg text-sm font-medium hover:bg-[#0C447C] disabled:opacity-50"
                        >
                          {templateSaving === t.key ? 'Saving...' : 'Save'}
                        </button>
                        <button
                          onClick={() => cancelEditingTemplate(t.key)}
                          className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm hover:bg-gray-50"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {t.subject && (
                        <div>
                          <span className="text-xs font-medium text-gray-500">Subject: </span>
                          <span className="text-xs text-gray-700">{t.subject}</span>
                        </div>
                      )}
                      <pre className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-800 whitespace-pre-wrap font-mono max-h-48 overflow-y-auto">
                        {t.body}
                      </pre>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

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

            <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
              <div>
                <p className="text-sm font-medium text-gray-900">Smart scheduling (Cal.com slots)</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {settings.smart_scheduling_enabled === 'true'
                    ? 'Reply emails include 3–5 tappable Cal.com time slots. Falls back to the generic booking link if the Cal.com API is unreachable.'
                    : 'Disabled — reply emails use the single generic booking link (current behavior).'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSettings({ ...settings, smart_scheduling_enabled: settings.smart_scheduling_enabled === 'true' ? 'false' : 'true' })}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ml-4 ${settings.smart_scheduling_enabled === 'true' ? 'bg-[#185FA5]' : 'bg-gray-300'}`}
              >
                <span className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${settings.smart_scheduling_enabled === 'true' ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>

            <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
              <div>
                <p className="text-sm font-medium text-gray-900">Retell AI voice agent</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {settings.retell_enabled === 'true'
                    ? 'Voice calls from Retell agents create/update cases. Configure your phone number to forward to Retell, and point Retell webhooks to /api/webhooks/retell.'
                    : 'Disabled — voice calls are not processed. Enable and configure API key + agent IDs below.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSettings({ ...settings, retell_enabled: settings.retell_enabled === 'true' ? 'false' : 'true' })}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ml-4 ${settings.retell_enabled === 'true' ? 'bg-[#185FA5]' : 'bg-gray-300'}`}
              >
                <span className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${settings.retell_enabled === 'true' ? 'translate-x-6' : 'translate-x-1'}`} />
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
