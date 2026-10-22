import { useState } from 'react';
import { api, type CreateServerPayload } from '../api';

/**
 * The monitored provider scope is exactly five remote MCP endpoints. No other
 * provider is registered automatically, and no third-party MCP server is
 * installed or self-hosted by MCPulse.
 */
const PRESET_SERVERS = [
  {
    name: 'GitHub Remote MCP',
    endpoint: 'https://api.githubcopilot.com/mcp/',
    note: 'Official GitHub remote MCP endpoint (Bearer token required for tools).',
  },
  {
    name: 'Google Drive Remote MCP',
    endpoint: 'https://drivemcp.googleapis.com/mcp/v1',
    note: 'Official Google Drive MCP endpoint (OAuth for tool execution).',
  },
  {
    name: 'Brave Search MCP',
    endpoint: 'https://api.search.brave.com/mcp',
    note: 'Brave Search MCP endpoint (free API key required).',
  },
  {
    name: 'Cloudflare Official Remote MCP',
    endpoint: 'https://mcp.cloudflare.com/mcp',
    note: 'Cloudflare official MCP endpoint (OAuth scope required).',
  },
  {
    name: 'Hugging Face Hub',
    endpoint: 'https://huggingface.co/mcp',
    note: 'Models, datasets & Hub file search. Free public access.',
  },
];

type Props = {
  onClose: () => void;
  onCreated: () => void;
};

export const AddServerModal = ({ onClose, onCreated }: Props) => {
  const [name, setName] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [intervalSeconds, setIntervalSeconds] = useState(60);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const applyPreset = (preset: (typeof PRESET_SERVERS)[number]) => {
    setName(preset.name);
    setEndpoint(preset.endpoint);
    setError(undefined);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(undefined);
    if (!name.trim()) return setError('Name is required.');
    let url: URL;
    try {
      url = new URL(endpoint.trim());
    } catch {
      return setError('Endpoint must be a valid URL (http:// or https://).');
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
      return setError('Endpoint must use http or https.');
    }
    if (intervalSeconds < 30 || intervalSeconds > 3600) {
      return setError('Interval must be between 30 and 3600 seconds.');
    }

    const payload: CreateServerPayload = {
      name: name.trim(),
      endpoint: endpoint.trim(),
      transportType: 'streamable_http',
      enabled: true,
      checkIntervalSeconds: intervalSeconds,
    };

    setSaving(true);
    try {
      await api.createServer(payload);
      onCreated();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Failed to register server.',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-server-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <h3 id="add-server-title" className="text-lg font-semibold text-slate-100">
            Add MCP Server
          </h3>
          <button
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Quick add presets */}
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Quick-add (Verified Remote MCP Endpoints)
          </p>
          <div className="mt-2 grid max-h-48 gap-2 overflow-y-auto pr-1">
            {PRESET_SERVERS.map((preset) => (
              <button
                key={preset.endpoint}
                type="button"
                onClick={() => applyPreset(preset)}
                className="group flex flex-col rounded-lg border border-slate-800 bg-slate-950/60 p-2.5 text-left transition-colors hover:border-cyan-500/50 hover:bg-slate-800/60"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-200 group-hover:text-cyan-300">
                    {preset.name}
                  </span>
                  <span className="text-[10px] text-cyan-400 opacity-0 group-hover:opacity-100">
                    Use preset →
                  </span>
                </div>
                <span className="mt-0.5 truncate font-mono text-xs text-cyan-400/80">
                  {preset.endpoint}
                </span>
                <span className="mt-0.5 text-xs text-slate-400">
                  {preset.note}
                </span>
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={(e) => void submit(e)} className="mt-4 space-y-4">
          <div>
            <label
              htmlFor="server-name"
              className="block text-xs font-medium text-slate-300"
            >
              Display name
            </label>
            <input
              id="server-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Production Weather MCP"
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="server-endpoint"
              className="block text-xs font-medium text-slate-300"
            >
              Streamable HTTP endpoint URL
            </label>
            <input
              id="server-endpoint"
              type="url"
              required
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="https://example.com/mcp"
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="server-interval"
              className="block text-xs font-medium text-slate-300"
            >
              Check interval (seconds)
            </label>
            <input
              id="server-interval"
              type="number"
              min={30}
              max={3600}
              required
              value={intervalSeconds}
              onChange={(e) =>
                setIntervalSeconds(parseInt(e.target.value, 10) || 60)
              }
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none"
            />
            <p className="mt-1 text-xs text-slate-500">
              30 – 3600 seconds. The scheduler runs every 10 seconds.
            </p>
          </div>

          {error && (
            <p
              role="alert"
              className="rounded-lg border border-rose-400/30 bg-rose-400/10 p-2.5 text-xs text-rose-300"
            >
              {error}
            </p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-slate-600 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-cyan-400 disabled:opacity-50"
            >
              {saving ? 'Adding…' : 'Add server'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
