import { createApp } from './app.js';
import { env } from './config/env.js';
import { getPool } from './db/pool.js';
import { createStreamableHttpChecker } from './monitoring/checker.js';
import { PostgresMonitoringRepository } from './monitoring/repository.js';
import { startMonitoringScheduler } from './monitoring/scheduler.js';
import { MonitoringService } from './monitoring/service.js';
import { PostgresServerRepository } from './servers/repository.js';

const pool = getPool();
const servers = new PostgresServerRepository(pool);
const monitoring = new MonitoringService(
  createStreamableHttpChecker(env.CHECK_TIMEOUT_MS),
  new PostgresMonitoringRepository(pool),
  env.INCIDENT_FAILURE_THRESHOLD,
);
const app = createApp(servers, monitoring);

app.listen(env.PORT, env.HOST, () => {
  console.info(
    JSON.stringify({ event: 'api_started', host: env.HOST, port: env.PORT }),
  );
  startMonitoringScheduler(servers, monitoring.asRunner());
  console.info(JSON.stringify({ event: 'scheduler_started' }));
});
