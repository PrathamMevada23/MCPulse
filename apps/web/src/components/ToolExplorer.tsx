import { useState } from 'react';
import { api, type McpTool, type ToolCheck } from '../api';

type Props = {
  serverId: string;
  serverName: string;
  tools: McpTool[];
  onRefreshTools: () => Promise<void>;
};

const formatSummary = (raw?: string | null): string => {
  if (!raw) return 'No description provided by server.';

  let cleaned = raw
    .replace(/^Call this tool to\s+/i, '')
    .replace(/^This tool is used to\s+/i, '')
    .replace(/^Use this tool to\s+/i, '')
    .replace(/^Inspect the\s+/i, 'Inspects ')
    .trim();

  cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  const firstSentence = cleaned.split(/(?<=[.!?])\s+/)[0];
  return firstSentence || cleaned;
};

export const ToolExplorer = ({ serverId, serverName, tools, onRefreshTools }: Props) => {
  const [discovering, setDiscovering] = useState(false);
  const [testingToolId, setTestingToolId] = useState<string>();
  const [expandedToolId, setExpandedToolId] = useState<string>();
  const [testResult, setTestResult] = useState<{
    toolId: string;
    result: ToolCheck;
  }>();
  const [error, setError] = useState<string>();
  const [search, setSearch] = useState('');

  const handleDiscover = async () => {
    setDiscovering(true);
    setError(undefined);
    try {
      await api.discoverTools(serverId);
      await onRefreshTools();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Discovery failed');
    } finally {
      setDiscovering(false);
    }
  };

  const handleTestTool = async (tool: McpTool) => {
    setTestingToolId(tool.id);
    setError(undefined);
    setTestResult(undefined);
    try {
      const res = await api.testTool(tool.id, {});
      setTestResult({ toolId: tool.id, result: res });
      await onRefreshTools();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Tool test execution failed');
    } finally {
      setTestingToolId(undefined);
    }
  };

  const filteredTools = tools.filter(
    (t) =>
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      (t.description && t.description.toLowerCase().includes(search.toLowerCase())),
  );

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5 shadow-sm">
      <div className="flex flex-col justify-between gap-4 border-b border-zinc-800/80 pb-4 sm:flex-row sm:items-center">
        <div>
          <h3 className="text-sm font-semibold text-zinc-200">
            Tool Observability ({serverName})
          </h3>
          <p className="mt-0.5 text-xs text-zinc-500">
            Discovered MCP functions, parameter schemas, and live execution tests.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Filter tools…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-44 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 text-xs text-zinc-200 placeholder-zinc-500 outline-none focus:border-zinc-700"
          />
          <button
            disabled={discovering}
            onClick={() => void handleDiscover()}
            className="h-8 rounded-md border border-zinc-800 bg-zinc-900 px-3 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-800 disabled:opacity-50"
          >
            {discovering ? 'Discovering…' : 'Discover tools'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-red-900/40 bg-red-950/20 p-2.5 text-xs text-red-300">
          {error}
        </div>
      )}

      {testResult && (
        <div className="mt-4 rounded-md border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-300">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-zinc-200">Test Execution</span>
            <span
              className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase ${
                testResult.result.outcome === 'success'
                  ? 'bg-emerald-950/40 text-emerald-400 border border-emerald-900/50'
                  : 'bg-red-950/40 text-red-400 border border-red-900/50'
              }`}
            >
              {testResult.result.outcome}
            </span>
          </div>
          <div className="mt-2 flex gap-4 text-zinc-400 text-[11px]">
            <span>Latency: <strong className="text-zinc-200">{testResult.result.durationMs} ms</strong></span>
            <span>Validation: <strong className={testResult.result.validationPassed ? 'text-emerald-400' : 'text-red-400'}>
              {testResult.result.validationPassed ? 'Passed' : 'Failed'}
            </strong></span>
          </div>
          {testResult.result.sanitizedError && (
            <p className="mt-1 text-red-300 text-[11px] font-mono">
              {testResult.result.sanitizedError}
            </p>
          )}
        </div>
      )}

      <div className="mt-4 divide-y divide-zinc-800/60 max-h-80 overflow-y-auto">
        {filteredTools.length === 0 ? (
          <div className="py-8 text-center text-xs text-zinc-500">
            {tools.length === 0
              ? 'No tools discovered yet. Click "Discover tools" to query the remote endpoint.'
              : 'No tools match the filter.'}
          </div>
        ) : (
          filteredTools.map((tool) => {
            const isExpanded = expandedToolId === tool.id;
            const summary = formatSummary(tool.description);
            const hasMore = tool.description && tool.description.length > summary.length;

            return (
              <div key={tool.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-zinc-200">
                        {tool.name}
                      </span>
                      {tool.lastOutcome && (
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${
                            tool.lastOutcome === 'success'
                              ? 'text-emerald-400 bg-emerald-950/40 border border-emerald-900/40'
                              : 'text-red-400 bg-red-950/40 border border-red-900/40'
                          }`}
                        >
                          {tool.lastOutcome}
                        </span>
                      )}
                      {tool.lastDurationMs !== null && tool.lastDurationMs !== undefined && (
                        <span className="font-mono text-[11px] text-zinc-500">
                          {tool.lastDurationMs}ms
                        </span>
                      )}
                    </div>

                    <p className="mt-1 text-xs text-zinc-400">
                      {isExpanded ? tool.description : summary}
                      {hasMore && (
                        <button
                          onClick={() => setExpandedToolId(isExpanded ? undefined : tool.id)}
                          className="ml-2 text-zinc-300 underline underline-offset-2 hover:text-white"
                        >
                          {isExpanded ? 'Less' : 'Details'}
                        </button>
                      )}
                    </p>
                  </div>

                  <button
                    disabled={testingToolId === tool.id}
                    onClick={() => void handleTestTool(tool)}
                    className="h-7 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-50"
                  >
                    {testingToolId === tool.id ? 'Running…' : 'Test'}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
