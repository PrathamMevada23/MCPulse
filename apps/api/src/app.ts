import cors from 'cors';
import express from 'express';
import { createAnalyticsRouter } from './analytics/routes.js';
import { env } from './config/env.js';
import { getPool } from './db/pool.js';
import { errorHandler } from './middleware/error-handler.js';
import { requireAdmin } from './middleware/admin.js';
import { createStreamableHttpChecker } from './monitoring/checker.js';
import { PostgresMonitoringRepository } from './monitoring/repository.js';
import { MonitoringService } from './monitoring/service.js';
import { validateResolvedDestination } from './monitoring/ssrf.js';
import { createReadyRouter, healthRouter } from './routes/health.js';
import { createAiAnalysisRouter } from './routes/analysis.js';
import { createToolsRouter } from './routes/tools.js';
import { PostgresServerRepository } from './servers/repository.js';
import { createServerRouter } from './servers/routes.js';
import type { ServerRepository } from './servers/types.js';

export const createApp = (
  repository?: ServerRepository,
  monitoringService?: MonitoringService,
) => {
  const app = express();
  const serverRepository =
    repository ?? new PostgresServerRepository(getPool());
  const checker = createStreamableHttpChecker(env.CHECK_TIMEOUT_MS);
  const service =
    monitoringService ??
    (repository
      ? undefined
      : new MonitoringService(
          checker,
          new PostgresMonitoringRepository(getPool()),
          env.INCIDENT_FAILURE_THRESHOLD,
        ));

  app.disable('x-powered-by');
  app.use(cors({ origin: env.CORS_ORIGIN }));
  app.use(express.json({ limit: '100kb' }));
  app.use('/health', healthRouter);
  // The administrative guard must be registered before the API routers so it
  // can reject the request before any handler runs.
  app.use('/api', requireAdmin);
  if (!repository || monitoringService) {
    const pool = getPool();
    app.use('/health/ready', createReadyRouter(pool));
    app.use(
      '/api',
      createAnalyticsRouter(pool, env.INCIDENT_FAILURE_THRESHOLD),
    );
    app.use('/api', createToolsRouter(pool, serverRepository, checker));
    app.use('/api', createAiAnalysisRouter(pool));
  }
  app.use(
    '/api/servers',
    createServerRouter(
      serverRepository,
      service?.asRunner(),
      validateResolvedDestination,
    ),
  );
  app.use(errorHandler);

  return app;
};
