import { describe, expect, it } from 'vitest';
import { createStreamableHttpChecker } from '../src/monitoring/checker.js';
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

describe('Streamable HTTP checker', () => {
  it('treats an SSE MCP initialization response as healthy', async () => {
    const checker = createStreamableHttpChecker(
      1_000,
      async () =>
        new Response(
          'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-03-26"}}\n\n',
          {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          },
        ),
    );

    await expect(checker(server)).resolves.toMatchObject({
      outcome: 'success',
      statusCode: 200,
    });
  });

  it('stores only a sanitized MCP error', async () => {
    const checker = createStreamableHttpChecker(
      1_000,
      async () =>
        new Response(
          JSON.stringify({
            error: {
              code: -32001,
              message: 'Authorization: Bearer super-secret-token denied',
            },
          }),
          {
            status: 401,
            headers: { 'content-type': 'application/json' },
          },
        ),
    );

    await expect(checker(server)).resolves.toMatchObject({
      outcome: 'failure',
      errorCode: 'MCP_-32001',
      sanitizedError: 'Authorization=[redacted] denied',
    });
  });
});
