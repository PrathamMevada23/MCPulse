import { useEffect, useState } from 'react';
import { api } from '../api';

type Props = {
  serverId: string;
  serverName: string;
};

type AnalysisData = {
  serverName: string;
  endpoint: string;
  analyzedAt: string;
  observedFacts: string[];
  hypotheses: string[];
  recommendations: string[];
};

export const AiDiagnosticsCard = ({ serverId, serverName }: Props) => {
  const [data, setData] = useState<AnalysisData>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const runAnalysis = async () => {
    setLoading(true);
    setError(undefined);
    try {
      const res = await api.getAiAnalysis(serverId);
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate diagnostic report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setData(undefined);
    setError(undefined);
  }, [serverId]);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5 shadow-sm">
      <div className="flex flex-col justify-between gap-4 border-b border-zinc-800/80 pb-4 sm:flex-row sm:items-center">
        <div>
          <h3 className="text-sm font-semibold text-zinc-200">
            Telemetry Diagnostics ({serverName})
          </h3>
          <p className="mt-0.5 text-xs text-zinc-500">
            Evidence-based synthesis of recent check outcomes, latency, and tool failures.
          </p>
        </div>
        <button
          disabled={loading}
          onClick={() => void runAnalysis()}
          className="h-8 rounded-md bg-zinc-100 px-3 text-xs font-medium text-zinc-950 transition-colors hover:bg-zinc-200 disabled:opacity-50"
        >
          {loading ? 'Evaluating…' : 'Run Diagnostics'}
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-red-900/40 bg-red-950/20 p-2.5 text-xs text-red-300">
          {error}
        </div>
      )}

      {loading && (
        <div className="py-8 text-center text-xs text-zinc-400">
          Evaluating telemetry history…
        </div>
      )}

      {!loading && !data && !error && (
        <div className="py-8 text-center text-xs text-zinc-500">
          Click &ldquo;Run Diagnostics&rdquo; to evaluate protocol evidence and hypotheses.
        </div>
      )}

      {!loading && data && (
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          {/* 1. Observed Facts */}
          <div className="rounded-md border border-zinc-800 bg-zinc-900/80 p-3.5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              1. Observed Facts
            </p>
            <ul className="mt-2.5 space-y-1.5 text-xs text-zinc-300">
              {data.observedFacts.map((fact, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <span className="text-zinc-600">—</span>
                  <span>{fact}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* 2. Hypotheses */}
          <div className="rounded-md border border-zinc-800 bg-zinc-900/80 p-3.5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              2. Failure Hypotheses
            </p>
            <ul className="mt-2.5 space-y-1.5 text-xs text-zinc-300">
              {data.hypotheses.map((hyp, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <span className="text-zinc-600">—</span>
                  <span>{hyp}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* 3. Recommendations */}
          <div className="rounded-md border border-zinc-800 bg-zinc-900/80 p-3.5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              3. Cloud Recommendations
            </p>
            <ul className="mt-2.5 space-y-1.5 text-xs text-zinc-300">
              {data.recommendations.map((rec, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <span className="text-zinc-600">—</span>
                  <span>{rec}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};
