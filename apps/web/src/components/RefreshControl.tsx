import { useEffect, useState } from 'react';
import type { RefreshInterval, UseAutoRefreshResult } from '../hooks/useAutoRefresh';

const INTERVALS: { label: string; value: RefreshInterval }[] = [
  { label: '15s', value: 15 },
  { label: '30s', value: 30 },
  { label: '60s', value: 60 },
  { label: 'Off', value: 0 },
];

const formatTime = (date: Date) =>
  date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

type Props = Pick<
  UseAutoRefreshResult,
  'lastUpdatedAt' | 'isRefreshing' | 'intervalSeconds' | 'setIntervalSeconds' | 'refresh'
>;

export const RefreshControl = ({
  lastUpdatedAt,
  isRefreshing,
  intervalSeconds,
  setIntervalSeconds,
  refresh,
}: Props) => {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1_000);
    return () => clearInterval(id);
  }, []);

  const secondsAgo = lastUpdatedAt
    ? Math.floor((Date.now() - lastUpdatedAt.getTime()) / 1_000)
    : null;

  const ageLabel =
    secondsAgo === null
      ? null
      : secondsAgo < 5
        ? 'just now'
        : secondsAgo < 60
          ? `${secondsAgo}s ago`
          : formatTime(lastUpdatedAt!);

  return (
    <div className="flex items-center gap-2">
      {/* Live pulse indicator */}
      <div className="flex items-center gap-1.5 px-2 py-1 text-xs text-zinc-400">
        <span className="relative flex h-2 w-2">
          {isRefreshing && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-zinc-400 opacity-75" />
          )}
          <span
            className={`relative inline-flex h-2 w-2 rounded-full ${
              isRefreshing ? 'bg-zinc-400' : 'bg-emerald-500'
            }`}
          />
        </span>
        {ageLabel && <span className="hidden sm:inline">{ageLabel}</span>}
      </div>

      {/* shadcn-style secondary button */}
      <button
        onClick={() => void refresh()}
        disabled={isRefreshing}
        className="inline-flex h-8 items-center justify-center rounded-md border border-zinc-800 bg-zinc-900 px-3 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-800 hover:text-zinc-100 disabled:pointer-events-none disabled:opacity-50"
      >
        <span className={`mr-1.5 text-xs ${isRefreshing ? 'animate-spin' : ''}`}>↻</span>
        Refresh
      </button>

      {/* Interval select */}
      <select
        value={intervalSeconds}
        onChange={(e) => setIntervalSeconds(Number(e.target.value) as RefreshInterval)}
        className="h-8 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 text-xs text-zinc-200 outline-none transition-colors hover:bg-zinc-800 focus:border-zinc-700"
      >
        {INTERVALS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
};
