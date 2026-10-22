import { Router } from 'express';
import type { Pool } from 'pg';

export const healthRouter = Router();

/**
 * Liveness probe. It only proves that the API process is up and serving; it
 * intentionally does not touch the database so a database outage does not
 * cause the container to be restarted.
 */
healthRouter.get('/', (_request, response) => {
  response.status(200).json({ status: 'ok', service: 'mcpulse-api' });
});

/**
 * Readiness probe. It verifies that the API can actually reach PostgreSQL, so
 * a deployment with a broken database connection is reported as unhealthy
 * instead of silently serving errors.
 */
export const createReadyRouter = (pool: Pool) => {
  const router = Router();

  router.get('/', async (_request, response) => {
    try {
      await pool.query('SELECT 1');
      response.status(200).json({
        status: 'ok',
        service: 'mcpulse-api',
        database: 'up',
      });
    } catch {
      response.status(503).json({
        status: 'degraded',
        service: 'mcpulse-api',
        database: 'down',
      });
    }
  });

  return router;
};
