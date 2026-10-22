import type { McpServer } from '../servers/types.js';

export type CheckOutcome = 'success' | 'failure';

export type CheckResult = {
  outcome: CheckOutcome;
  durationMs: number;
  statusCode: number | null;
  errorCode: string | null;
  sanitizedError: string | null;
  toolNames: string[] | null;
};

export type StoredCheck = CheckResult & {
  id: string;
  serverId: string;
  checkedAt: string;
};

export interface MonitoringRepository {
  recordCheck(
    input: CheckResult & { serverId: string; failureThreshold: number },
  ): Promise<StoredCheck>;
}

export type ServerCheckRunner = (server: McpServer) => Promise<StoredCheck>;

// --- Tool-Level Types ---

export type DiscoveredTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

export type ToolDiscoveryResult = {
  success: boolean;
  durationMs: number;
  tools: DiscoveredTool[];
  error?: string;
};

export type ToolExecutionResult = {
  outcome: CheckOutcome;
  durationMs: number;
  statusCode: number | null;
  errorCode: string | null;
  sanitizedError: string | null;
  responseSummary?: Record<string, unknown>;
  validationPassed: boolean;
  validationMessage?: string;
};
