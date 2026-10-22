import { describe, expect, it } from 'vitest';
import { MonitoringService } from '../src/monitoring/service.js';
import type {
  CheckResult,
  MonitoringRepository,
} from '../src/monitoring/types.js';
import type { McpServer } from '../src/servers/types.js';

const server: McpServer = {
  id: '6ecab887-0b6b-4b3c-a7b0-41a5ca0b933e',
  name: 'DeepWiki',
  endpoint: 'https://mcp.deepwiki.com/mcp',
  transportType: 'streamable_http',
  enabled: true,
  checkIntervalSeconds: 60,
  createdAt: '2026-09-27T00:00:00.000Z',
  updatedAt: '2026-09-27T00:00:00.000Z',
};
const result: CheckResult = {
  outcome: 'success',
  durationMs: 12,
  statusCode: 200,
  errorCode: null,
  sanitizedError: null,
  toolNames: null,
};

describe('MonitoringService', () => {
  it('prevents overlapping checks for the same server', async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const repository: MonitoringRepository = {
      recordCheck: async (input) => ({
        ...input,
        id: 'check-id',
        checkedAt: new Date().toISOString(),
      }),
    };
    const service = new MonitoringService(
      async () => {
        await blocked;
        return result;
      },
      repository,
      3,
    );

    const first = service.run(server);
    await expect(service.run(server)).rejects.toThrow('CHECK_ALREADY_RUNNING');
    release();
    await expect(first).resolves.toMatchObject({ outcome: 'success' });
  });
});
