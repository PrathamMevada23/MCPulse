import cron from 'node-cron';
import type { ServerRepository } from '../servers/types.js';
import type { ServerCheckRunner } from './types.js';

export const startMonitoringScheduler = (
  servers: ServerRepository,
  runCheck: ServerCheckRunner,
) => {
  const lastRunAt = new Map<string, number>();
  return cron.schedule('*/10 * * * * *', async () => {
    try {
      const now = Date.now();
      for (const server of await servers.list()) {
        const due =
          now - (lastRunAt.get(server.id) ?? 0) >=
          server.checkIntervalSeconds * 1000;
        if (!server.enabled || !due) continue;
        lastRunAt.set(server.id, now);
        void runCheck(server).catch((error: unknown) =>
          console.error(
            JSON.stringify({
              event: 'scheduled_check_failed',
              serverId: server.id,
              error: error instanceof Error ? error.message : 'Unknown error',
            }),
          ),
        );
      }
    } catch (error) {
      console.error(
        JSON.stringify({
          event: 'scheduler_cycle_failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        }),
      );
    }
  });
};
