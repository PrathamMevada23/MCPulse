import type { McpServer } from '../servers/types.js';
import { sanitizeError } from './sanitize.js';
import { validateSafeRemoteUrl } from './ssrf.js';
import type { CheckResult, DiscoveredTool, ToolDiscoveryResult, ToolExecutionResult } from './types.js';

type FetchImplementation = typeof fetch;

/**
 * Raised when an endpoint is rejected by the SSRF guard. It is surfaced as a
 * distinct error code so the incident history explains a policy block instead
 * of a generic network failure.
 */
class BlockedEndpointError extends Error {
  constructor(endpoint: string, reason: string) {
    super(`Endpoint ${endpoint} was blocked by the SSRF guard: ${reason}`);
    this.name = 'BlockedEndpointError';
  }
}

const readMcpPayload = async (response: Response) => {
  const body = await response.text();
  if (response.headers.get('content-type')?.includes('text/event-stream')) {
    const data = body
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('');
    if (!data) return { error: { message: 'Empty SSE payload from endpoint' } };
    try {
      return JSON.parse(data) as {
        result?: unknown;
        error?: { message?: string; code?: number };
      };
    } catch {
      return { error: { message: data } };
    }
  }

  if (!body || body.trim() === '') {
    return { error: { message: `Empty response with status HTTP ${response.status}` } };
  }

  try {
    return JSON.parse(body) as {
      result?: unknown;
      error?: { message?: string; code?: number };
    };
  } catch {
    return { error: { message: body.slice(0, 300) } };
  }
};

export const createStreamableHttpChecker = (
  timeoutMs: number,
  fetchImplementation: FetchImplementation = fetch,
) => {
  const sendMcpRequest = async (
    endpoint: string,
    method: string,
    params: Record<string, unknown> = {},
    requestId = 1,
    sessionId?: string,
  ) => {
    const guard = validateSafeRemoteUrl(endpoint);
    if (!guard.safe) {
      throw new BlockedEndpointError(endpoint, guard.reason ?? 'unsafe destination');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const headers: Record<string, string> = {
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
        'MCP-Protocol-Version': '2025-03-26',
      };
      if (sessionId) {
        headers['Mcp-Session-Id'] = sessionId;
      }

      const response = await fetchImplementation(endpoint, {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: requestId,
          method,
          params,
        }),
      });
      const payload = await readMcpPayload(response);
      const returnedSessionId = response.headers.get('mcp-session-id') ?? undefined;
      return { response, payload, sessionId: returnedSessionId };
    } finally {
      clearTimeout(timeout);
    }
  };

  const checkServer = async (server: McpServer): Promise<CheckResult> => {
    const startedAt = performance.now();
    try {
      const { response, payload } = await sendMcpRequest(
        server.endpoint,
        'initialize',
        {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'mcpulse', version: '0.1.0' },
        },
      );
      const durationMs = Math.round(performance.now() - startedAt);

      if (!response.ok || payload.error || !payload.result) {
        return {
          outcome: 'failure',
          durationMs,
          statusCode: response.status,
          errorCode: payload.error?.code
            ? `MCP_${payload.error.code}`
            : `HTTP_${response.status}`,
          sanitizedError: sanitizeError(
            payload.error?.message ?? 'MCP initialization failed',
          ),
          toolNames: null,
        };
      }

      return {
        outcome: 'success',
        durationMs,
        statusCode: response.status,
        errorCode: null,
        sanitizedError: null,
        toolNames: null,
      };
    } catch (error) {
      if (error instanceof BlockedEndpointError) {
        return {
          outcome: 'failure',
          durationMs: Math.round(performance.now() - startedAt),
          statusCode: null,
          errorCode: 'SSRF_BLOCKED',
          sanitizedError: sanitizeError(error.message),
          toolNames: null,
        };
      }
      const timeoutError =
        error instanceof DOMException && error.name === 'AbortError';
      return {
        outcome: 'failure',
        durationMs: Math.round(performance.now() - startedAt),
        statusCode: null,
        errorCode: timeoutError ? 'TIMEOUT' : 'NETWORK_ERROR',
        sanitizedError: sanitizeError(
          timeoutError ? `Request timed out after ${timeoutMs}ms` : error,
        ),
        toolNames: null,
      };
    }
  };

  const discoverTools = async (server: McpServer): Promise<ToolDiscoveryResult> => {
    const startedAt = performance.now();
    try {
      // 1. Initialize
      const initRes = await sendMcpRequest(server.endpoint, 'initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'mcpulse', version: '0.1.0' },
      });

      // 2. tools/list (pass Mcp-Session-Id if returned by the server)
      const { response, payload } = await sendMcpRequest(
        server.endpoint,
        'tools/list',
        {},
        2,
        initRes.sessionId,
      );

      const durationMs = Math.round(performance.now() - startedAt);

      if (!response.ok || payload.error) {
        return {
          success: false,
          durationMs,
          tools: [],
          error: sanitizeError(payload.error?.message ?? `HTTP ${response.status}`) ?? undefined,
        };
      }

      const rawResult = payload.result as { tools?: unknown[] } | undefined;
      const rawTools = Array.isArray(rawResult?.tools) ? rawResult.tools : [];

      const tools: DiscoveredTool[] = rawTools.map((t: unknown) => {
        const item = t as Record<string, unknown>;
        return {
          name: String(item.name || 'unnamed_tool'),
          description: item.description ? String(item.description) : undefined,
          inputSchema:
            typeof item.inputSchema === 'object' && item.inputSchema !== null
              ? (item.inputSchema as Record<string, unknown>)
              : undefined,
        };
      });

      return {
        success: true,
        durationMs,
        tools,
      };
    } catch (err) {
      return {
        success: false,
        durationMs: Math.round(performance.now() - startedAt),
        tools: [],
        error: sanitizeError(err) ?? 'Tool discovery failed',
      };
    }
  };

  const executeTool = async (
    server: McpServer,
    toolName: string,
    args: Record<string, unknown> = {},
    validationRules: Array<{ field?: string; operator?: string; value?: unknown }> = [],
  ): Promise<ToolExecutionResult> => {
    const startedAt = performance.now();
    try {
      // 1. Initialize
      const initRes = await sendMcpRequest(server.endpoint, 'initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'mcpulse', version: '0.1.0' },
      });

      // 2. tools/call
      const { response, payload } = await sendMcpRequest(
        server.endpoint,
        'tools/call',
        {
          name: toolName,
          arguments: args,
        },
        3,
        initRes.sessionId,
      );

      const durationMs = Math.round(performance.now() - startedAt);

      if (!response.ok || payload.error) {
        return {
          outcome: 'failure',
          durationMs,
          statusCode: response.status,
          errorCode: payload.error?.code ? `MCP_${payload.error.code}` : `HTTP_${response.status}`,
          sanitizedError: sanitizeError(payload.error?.message ?? `HTTP ${response.status}`),
          validationPassed: false,
          validationMessage: 'Execution failed at protocol level',
        };
      }

      const result = payload.result as Record<string, unknown> | undefined;

      // Validate rules
      let validationPassed = true;
      let validationMessage: string | undefined;

      if (validationRules.length > 0 && result) {
        for (const rule of validationRules) {
          if (rule.field && !(rule.field in result)) {
            validationPassed = false;
            validationMessage = `Missing expected field: ${rule.field}`;
            break;
          }
        }
      }

      return {
        outcome: 'success',
        durationMs,
        statusCode: response.status,
        errorCode: null,
        sanitizedError: null,
        responseSummary: result ? { keys: Object.keys(result) } : undefined,
        validationPassed,
        validationMessage,
      };
    } catch (err) {
      const timeoutError =
        err instanceof DOMException && err.name === 'AbortError';
      return {
        outcome: 'failure',
        durationMs: Math.round(performance.now() - startedAt),
        statusCode: null,
        errorCode: timeoutError ? 'TIMEOUT' : 'NETWORK_ERROR',
        sanitizedError: sanitizeError(timeoutError ? `Timed out after ${timeoutMs}ms` : err),
        validationPassed: false,
        validationMessage: 'Network or timeout exception during tool call',
      };
    }
  };

  // Preserve backwards compatibility: invoking checker(server) directly runs checkServer
  const runner = (server: McpServer) => checkServer(server);
  runner.checkServer = checkServer;
  runner.discoverTools = discoverTools;
  runner.executeTool = executeTool;

  return runner;
};
