import { useCallback, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AddServerModal } from '../components/AddServerModal';
import { AiDiagnosticsCard } from '../components/AiDiagnosticsCard';
import { RefreshControl } from '../components/RefreshControl';
import { ToolExplorer } from '../components/ToolExplorer';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import {
  api,
  type Check,
  type DashboardSummary,
  type McpTool,
  type ServerStatus,
} from '../api';

const statusBadge: Record<ServerStatus, { dot: string; text: string }> = {
  healthy: { dot: 'bg-emerald-500', text: 'text-emerald-400' },
  degraded: { dot: 'bg-amber-500', text: 'text-amber-400' },
  down: { dot: 'bg-rose-500', text: 'text-rose-400' },
  unknown: { dot: 'bg-zinc-500', text: 'text-zinc-400' },
  disabled: { dot: 'bg-zinc-600', text: 'text-zinc-500' },
};

const formatDate = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(value))
    : 'Never';

export const DashboardPage = () => {
  const [summary, setSummary] = useState<DashboardSummary>();
  const [selectedServerId, setSelectedServerId] = useState<string>();
  const [checks, setChecks] = useState<Check[]>([]);
  const [serverTools, setServerTools] = useState<McpTool[]>([]);
  const [error, setError] = useState<string>();
  const [checkingId, setCheckingId] = useState<string>();
  const [showAddModal, setShowAddModal] = useState(false);
  const [deletingId, setDeletingId] = useState<string>();

  const loadServerDetails = useCallback(async (serverId: string) => {
    try {
      const [checksRes, toolsRes] = await Promise.all([
        api.checks(serverId).catch(() => ({ checks: [] })),
        api.getTools(serverId).catch(() => ({ tools: [] })),
      ]);
      setChecks(checksRes.checks.reverse());
      setServerTools(toolsRes.tools);
    } catch {
      setChecks([]);
      setServerTools([]);
    }
  }, []);

  const fetchData = useCallback(async () => {
    setError(undefined);
    try {
      const next = await api.dashboard();
      setSummary(next);

      setSelectedServerId((currentId) => {
        const stillExists = next.servers.some((s) => s.id === currentId);
        const targetId = stillExists ? currentId : next.servers[0]?.id;
        if (targetId) {
          void loadServerDetails(targetId);
        } else {
          setChecks([]);
          setServerTools([]);
        }
        return targetId;
      });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Unable to load dashboard',
      );
    }
  }, [loadServerDetails]);

  const { lastUpdatedAt, isRefreshing, intervalSeconds, setIntervalSeconds, refresh } =
    useAutoRefresh(fetchData, 30);

  const runCheck = async (serverId: string) => {
    setCheckingId(serverId);
    setError(undefined);
    try {
      await api.checkNow(serverId);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to run check');
    } finally {
      setCheckingId(undefined);
    }
  };

  const deleteServer = async (serverId: string) => {
    if (!window.confirm('Remove this server and all its history?')) return;
    setDeletingId(serverId);
    setError(undefined);
    try {
      await api.deleteServer(serverId);
      await refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Unable to delete server',
      );
    } finally {
      setDeletingId(undefined);
    }
  };

  if (!summary && isRefreshing)
    return (
      <div className="py-20 text-center text-sm text-zinc-500">
        Loading monitoring telemetry…
      </div>
    );

  if (error && !summary)
    return (
      <div className="rounded-lg border border-red-900/50 bg-red-950/20 p-6 text-center">
        <p className="text-sm text-red-300">{error}</p>
        <button
          onClick={() => void refresh()}
          className="mt-4 rounded-md bg-zinc-100 px-4 py-2 text-xs font-semibold text-zinc-950 hover:bg-zinc-200"
        >
          Retry connection
        </button>
      </div>
    );

  const counts = summary?.counts ?? {
    healthy: 0,
    degraded: 0,
    down: 0,
    unknown: 0,
    disabled: 0,
  };

  const selectedServer = summary?.servers.find((s) => s.id === selectedServerId);

  const totalChecks = checks.length;
  const successfulChecks = checks.filter((c) => c.outcome === 'success').length;
  const availabilitySla =
    totalChecks > 0 ? ((successfulChecks / totalChecks) * 100).toFixed(1) : null;

  return (
    <div className="space-y-8">
      {showAddModal && (
        <AddServerModal
          onClose={() => setShowAddModal(false)}
          onCreated={() => {
            setShowAddModal(false);
            void refresh();
          }}
        />
      )}

      {/* Header bar */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-100">
            Overview
          </h1>
          <p className="mt-0.5 text-xs text-zinc-400">
            Real-time MCP protocol health, availability SLAs, and tool observability.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <RefreshControl
            lastUpdatedAt={lastUpdatedAt}
            isRefreshing={isRefreshing}
            intervalSeconds={intervalSeconds}
            setIntervalSeconds={setIntervalSeconds}
            refresh={refresh}
          />
          <button
            onClick={() => setShowAddModal(true)}
            className="inline-flex h-8 items-center justify-center rounded-md bg-zinc-100 px-3 text-xs font-medium text-zinc-950 transition-colors hover:bg-zinc-200"
          >
            + Add server
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-900/40 bg-red-950/20 p-3 text-xs text-red-300">
          {error}
        </div>
      )}

      {/* Metric Cards (shadcn style) */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Total Servers', value: summary?.servers.length ?? 0 },
          { label: 'Healthy Protocol', value: counts.healthy },
          { label: 'Outages / Degraded', value: counts.degraded + counts.down },
          {
            label: 'Open Incidents',
            value: summary?.incidents.filter((i) => i.state === 'open').length ?? 0,
          },
        ].map((item) => (
          <div
            key={item.label}
            className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 shadow-sm"
          >
            <p className="text-xs font-medium text-zinc-400">{item.label}</p>
            <p className="mt-2 text-2xl font-bold tracking-tight text-zinc-100">
              {item.value}
            </p>
          </div>
        ))}
      </div>

      {/* Servers Table */}
      {!summary?.servers.length ? (
        <div className="rounded-lg border border-dashed border-zinc-800 p-12 text-center">
          <p className="text-sm text-zinc-400">No servers configured.</p>
          <button
            onClick={() => setShowAddModal(true)}
            className="mt-3 text-xs font-medium text-zinc-200 underline underline-offset-4 hover:text-white"
          >
            Add an MCP server to begin monitoring
          </button>
        </div>
      ) : (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 shadow-sm">
          <div className="border-b border-zinc-800 px-4 py-3">
            <h2 className="text-sm font-semibold text-zinc-200">Registered Endpoints</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-zinc-800 bg-zinc-900/80 text-zinc-400">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Service / Endpoint</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Last Checked</th>
                  <th className="px-4 py-2.5 font-medium">Latency</th>
                  <th className="px-4 py-2.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {summary.servers.map((server) => {
                  const isSelected = server.id === selectedServerId;
                  const badge = statusBadge[server.status];

                  return (
                    <tr
                      key={server.id}
                      onClick={() => {
                        setSelectedServerId(server.id);
                        void loadServerDetails(server.id);
                      }}
                      className={`cursor-pointer transition-colors ${
                        isSelected ? 'bg-zinc-800/60' : 'hover:bg-zinc-900/60'
                      }`}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              isSelected ? 'bg-zinc-100' : 'bg-transparent'
                            }`}
                          />
                          <p className="font-medium text-zinc-200">{server.name}</p>
                        </div>
                        <p className="mt-0.5 max-w-xs truncate font-mono text-[11px] text-zinc-500">
                          {server.endpoint}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 font-medium capitalize">
                          <span className={`h-1.5 w-1.5 rounded-full ${badge.dot}`} />
                          <span className={badge.text}>{server.status}</span>
                        </span>
                      </td>
                      <td className="px-4 py-3 text-zinc-400">
                        {formatDate(server.lastCheckedAt)}
                      </td>
                      <td className="px-4 py-3 font-mono text-zinc-300">
                        {server.lastDurationMs === null ? '—' : `${server.lastDurationMs} ms`}
                      </td>
                      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            disabled={!server.enabled || checkingId === server.id}
                            onClick={() => void runCheck(server.id)}
                            className="h-7 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 text-[11px] font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-50"
                          >
                            {checkingId === server.id ? 'Checking…' : 'Check'}
                          </button>
                          <button
                            disabled={deletingId === server.id}
                            onClick={() => void deleteServer(server.id)}
                            className="h-7 rounded-md border border-zinc-800 bg-zinc-900 px-2 text-[11px] text-zinc-400 hover:border-red-900/50 hover:text-red-400 disabled:opacity-50"
                          >
                            {deletingId === server.id ? '…' : 'Delete'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Latency & Incident Analytics Grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Latency Chart Card */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800/80 pb-4">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-zinc-200">Protocol Latency</h3>
                {availabilitySla !== null && (
                  <span
                    className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${
                      Number(availabilitySla) >= 95
                        ? 'border-emerald-900/50 bg-emerald-950/30 text-emerald-400'
                        : Number(availabilitySla) >= 75
                          ? 'border-amber-900/50 bg-amber-950/30 text-amber-400'
                          : 'border-red-900/50 bg-red-950/30 text-red-400'
                    }`}
                  >
                    {availabilitySla}% SLA
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-zinc-500">
                {selectedServer ? selectedServer.name : 'Select a server'}
              </p>
            </div>

            {summary && summary.servers.length > 1 && (
              <select
                value={selectedServerId ?? ''}
                onChange={(e) => {
                  const id = e.target.value;
                  setSelectedServerId(id);
                  void loadServerDetails(id);
                }}
                className="h-7 rounded-md border border-zinc-800 bg-zinc-900 px-2 text-xs text-zinc-300 outline-none hover:bg-zinc-800"
              >
                {summary.servers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="mt-4 h-60">
            {checks.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={checks}>
                  <CartesianGrid stroke="#27272a" vertical={false} strokeDasharray="3 3" />
                  <XAxis
                    dataKey="checkedAt"
                    tickFormatter={(v) => new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    stroke="#71717a"
                    fontSize={11}
                    tickLine={false}
                  />
                  <YAxis stroke="#71717a" fontSize={11} unit="ms" tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', borderRadius: '6px', fontSize: '11px' }}
                    labelFormatter={(v) => formatDate(String(v))}
                  />
                  <Line
                    type="monotone"
                    dataKey="durationMs"
                    stroke="#fafafa"
                    strokeWidth={1.5}
                    dot={false}
                    activeDot={{ r: 4, fill: '#fafafa' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-zinc-500">
                No latency history recorded yet.
              </div>
            )}
          </div>
        </div>

        {/* Incidents Card */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5 shadow-sm">
          <div className="border-b border-zinc-800/80 pb-4">
            <h3 className="text-sm font-semibold text-zinc-200">Incident Feed</h3>
            <p className="mt-0.5 text-xs text-zinc-500">
              Triggered after 3 consecutive failure threshold breaches.
            </p>
          </div>
          <div className="mt-4 divide-y divide-zinc-800/60 max-h-60 overflow-y-auto">
            {summary?.incidents.length ? (
              summary.incidents.map((incident) => (
                <div key={incident.id} className="py-2.5 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-zinc-200">
                      {incident.serverName ?? 'Incident'}
                    </span>
                    <span
                      className={`font-mono text-[10px] font-semibold uppercase ${
                        incident.state === 'open' ? 'text-red-400' : 'text-emerald-400'
                      }`}
                    >
                      {incident.state}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-zinc-400">{incident.summary}</p>
                  <p className="mt-0.5 text-[11px] text-zinc-500">
                    Started {formatDate(incident.startedAt)}
                  </p>
                </div>
              ))
            ) : (
              <div className="flex h-48 items-center justify-center text-xs text-zinc-500">
                All services operational within SLA limits.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tool Explorer & AI Diagnostics */}
      {selectedServer && (
        <div className="space-y-6">
          <ToolExplorer
            serverId={selectedServer.id}
            serverName={selectedServer.name}
            tools={serverTools}
            onRefreshTools={() => loadServerDetails(selectedServer.id)}
          />
          <AiDiagnosticsCard
            serverId={selectedServer.id}
            serverName={selectedServer.name}
          />
        </div>
      )}
    </div>
  );
};
