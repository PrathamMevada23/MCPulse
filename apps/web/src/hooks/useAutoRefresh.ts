import { useCallback, useEffect, useRef, useState } from 'react';

export type RefreshInterval = 15 | 30 | 60 | 0; // 0 = off

export type UseAutoRefreshResult = {
  lastUpdatedAt: Date | null;
  isRefreshing: boolean;
  intervalSeconds: RefreshInterval;
  setIntervalSeconds: (value: RefreshInterval) => void;
  refresh: () => void;
};

export const useAutoRefresh = (
  onRefresh: () => Promise<void>,
  defaultInterval: RefreshInterval = 30,
): UseAutoRefreshResult => {
  const [intervalSeconds, setIntervalSeconds] =
    useState<RefreshInterval>(defaultInterval);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inProgressRef = useRef(false);

  const refresh = useCallback(async () => {
    if (inProgressRef.current) return;
    inProgressRef.current = true;
    setIsRefreshing(true);
    try {
      await onRefresh();
      setLastUpdatedAt(new Date());
    } finally {
      inProgressRef.current = false;
      setIsRefreshing(false);
    }
  }, [onRefresh]);

  // Start / restart the interval whenever the interval changes
  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (intervalSeconds > 0) {
      timerRef.current = setInterval(() => {
        void refresh();
      }, intervalSeconds * 1_000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [intervalSeconds, refresh]);

  return {
    lastUpdatedAt,
    isRefreshing,
    intervalSeconds,
    setIntervalSeconds,
    refresh,
  };
};
