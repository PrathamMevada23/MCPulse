import { Router } from 'express';
import { z } from 'zod';
import { validateSafeRemoteUrl } from '../monitoring/ssrf.js';
import type { ServerCheckRunner } from '../monitoring/types.js';
import type { ServerRepository } from './types.js';

const endpointSchema = z
  .string()
  .url()
  .max(2048)
  .refine(
    (value) => ['http:', 'https:'].includes(new URL(value).protocol),
    'Endpoint must use HTTP or HTTPS.',
  )
  .refine(
    (value) => validateSafeRemoteUrl(value).safe,
    'Endpoint resolves to a prohibited destination (loopback, private, link-local or cloud metadata).',
  );

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  endpoint: endpointSchema,
  transportType: z.literal('streamable_http'),
  enabled: z.boolean().default(true),
  checkIntervalSeconds: z.number().int().min(30).max(3600).default(60),
});

const updateSchema = createSchema
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    'At least one field is required.',
  );
const idSchema = z.string().uuid();

export const createServerRouter = (
  repository: ServerRepository,
  checkRunner?: ServerCheckRunner,
  /**
   * Optional DNS-aware destination guard. It is injected so the registry
   * routes stay deterministic in unit tests (no network lookups).
   */
  guardEndpoint?: (
    endpoint: string,
  ) => Promise<{ safe: boolean; reason?: string }>,
) => {
  const router = Router();

  const assertEndpointAllowed = async (endpoint: string) => {
    if (!guardEndpoint) return null;
    const verdict = await guardEndpoint(endpoint);
    if (verdict.safe) return null;
    return verdict.reason ?? 'Prohibited destination';
  };

  router.get('/', async (_request, response, next) => {
    try {
      response.json({ servers: await repository.list() });
    } catch (error) {
      next(error);
    }
  });

  router.post('/', async (request, response, next) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success)
      return response.status(400).json({
        error: 'Invalid server configuration',
        details: parsed.error.flatten(),
      });
    try {
      const blocked = await assertEndpointAllowed(parsed.data.endpoint);
      if (blocked)
        return response.status(400).json({ error: `Endpoint rejected: ${blocked}` });
      response
        .status(201)
        .json({ server: await repository.create(parsed.data) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/:id', async (request, response, next) => {
    const parsed = idSchema.safeParse(request.params.id);
    if (!parsed.success)
      return response.status(400).json({ error: 'Invalid server id' });
    try {
      const server = await repository.findById(parsed.data);
      return server
        ? response.json({ server })
        : response.status(404).json({ error: 'Server not found' });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/:id', async (request, response, next) => {
    const id = idSchema.safeParse(request.params.id);
    const input = updateSchema.safeParse(request.body);
    if (!id.success || !input.success)
      return response.status(400).json({ error: 'Invalid server update' });
    try {
      if (input.data.endpoint) {
        const blocked = await assertEndpointAllowed(input.data.endpoint);
        if (blocked)
          return response
            .status(400)
            .json({ error: `Endpoint rejected: ${blocked}` });
      }
      const server = await repository.update(id.data, input.data);
      return server
        ? response.json({ server })
        : response.status(404).json({ error: 'Server not found' });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/:id', async (request, response, next) => {
    const parsed = idSchema.safeParse(request.params.id);
    if (!parsed.success)
      return response.status(400).json({ error: 'Invalid server id' });
    try {
      return (await repository.delete(parsed.data))
        ? response.status(204).end()
        : response.status(404).json({ error: 'Server not found' });
    } catch (error) {
      next(error);
    }
  });

  router.post('/:id/check-now', async (request, response, next) => {
    const parsed = idSchema.safeParse(request.params.id);
    if (!parsed.success)
      return response.status(400).json({ error: 'Invalid server id' });
    if (!checkRunner)
      return response
        .status(503)
        .json({ error: 'Monitoring is not configured' });
    try {
      const server = await repository.findById(parsed.data);
      if (!server)
        return response.status(404).json({ error: 'Server not found' });
      if (!server.enabled)
        return response
          .status(409)
          .json({ error: 'Server monitoring is disabled' });
      const check = await checkRunner(server);
      return response.status(201).json({ check });
    } catch (error) {
      if (error instanceof Error && error.message === 'CHECK_ALREADY_RUNNING') {
        return response
          .status(409)
          .json({ error: 'A check is already running for this server' });
      }
      next(error);
    }
  });

  return router;
};
