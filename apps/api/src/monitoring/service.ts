import type { McpServer } from '../servers/types.js';
import type {
  MonitoringRepository,
  ServerCheckRunner,
  StoredCheck,
} from './types.js';

export class MonitoringService {
  private readonly activeServerIds = new Set<string>();

  constructor(
    private readonly check: (
      server: McpServer,
    ) => Promise<import('./types.js').CheckResult>,
    private readonly repository: MonitoringRepository,
    private readonly failureThreshold: number,
  ) {}

  async run(server: McpServer): Promise<StoredCheck> {
    if (this.activeServerIds.has(server.id))
      throw new Error('CHECK_ALREADY_RUNNING');
    this.activeServerIds.add(server.id);
    try {
      const result = await this.check(server);
      return await this.repository.recordCheck({
        ...result,
        serverId: server.id,
        failureThreshold: this.failureThreshold,
      });
    } finally {
      this.activeServerIds.delete(server.id);
    }
  }

  asRunner(): ServerCheckRunner {
    return (server) => this.run(server);
  }
}
