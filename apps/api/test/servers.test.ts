import { describe, expect, it } from 'vitest';
import { createServerRouter } from '../src/servers/routes.js';
import type { McpServer, ServerRepository } from '../src/servers/types.js';
import { mockReq, mockRes, noopNext } from './helpers.js';

const fixedServer: McpServer = {
  id: '6ecab887-0b6b-4b3c-a7b0-41a5ca0b933e',
  name: 'DeepWiki',
  endpoint: 'https://mcp.deepwiki.com/mcp',
  transportType: 'streamable_http',
  enabled: true,
  checkIntervalSeconds: 60,
  createdAt: '2026-09-27T00:00:00.000Z',
  updatedAt: '2026-09-27T00:00:00.000Z',
};

const repository: ServerRepository = {
  list: async () => [fixedServer],
  findById: async (id) => (id === fixedServer.id ? fixedServer : null),
  create: async (input) => ({ ...fixedServer, ...input }),
  update: async (id, input) =>
    id === fixedServer.id ? { ...fixedServer, ...input } : null,
  delete: async (id) => id === fixedServer.id,
};

// The POST '/' handler is the second entry in the router stack
// (index 0 is GET '/', index 1 is POST '/')
const router = createServerRouter(repository);
const postHandler = router.stack.find(
  (layer) => layer.route?.path === '/' && layer.route.methods.post,
)?.route?.stack[0]?.handle;

if (!postHandler) throw new Error('Could not find POST / handler in server router');

describe('server registry API', () => {
  it('rejects a non-HTTP endpoint before persistence', async () => {
    const req = mockReq({
      body: {
        name: 'Invalid',
        endpoint: 'file:///private/secret',
        transportType: 'streamable_http',
      },
    });
    const res = mockRes();

    await postHandler(req, res, noopNext);

    const { status } = res.result();
    expect(status).toBe(400);
  });

  it('creates a valid server configuration', async () => {
    const req = mockReq({
      body: {
        name: 'DeepWiki',
        endpoint: 'https://mcp.deepwiki.com/mcp',
        transportType: 'streamable_http',
        checkIntervalSeconds: 60,
      },
    });
    const res = mockRes();

    await postHandler(req, res, noopNext);

    const { status, body } = res.result();
    expect(status).toBe(201);
    expect((body as { server: { endpoint: string } }).server.endpoint).toBe(
      'https://mcp.deepwiki.com/mcp',
    );
  });
});
