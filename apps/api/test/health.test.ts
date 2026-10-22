import { describe, expect, it } from 'vitest';
import { healthRouter } from '../src/routes/health.js';
import { mockReq, mockRes, noopNext } from './helpers.js';

// In Express 5, healthRouter.stack[0] is a Layer wrapping a Route.
// The Route's own stack contains the actual user-defined handler.
const routeLayer = healthRouter.stack[0];
const routeStack = routeLayer?.route?.stack ?? routeLayer?.stack ?? [];
// The user handler is either on the route's stack or is the layer's handle itself
const healthHandler: (req: unknown, res: unknown, next: unknown) => unknown =
  routeStack[0]?.handle ?? routeLayer.handle;

describe('GET /health', () => {
  it('returns the API status', async () => {
    const req = mockReq();
    const res = mockRes();

    // Express v5 handler may return a Promise
    await Promise.resolve(healthHandler(req, res, noopNext));

    const { status, body } = res.result();
    expect(status).toBe(200);
    expect(body).toEqual({ status: 'ok', service: 'mcpulse-api' });
  });
});
