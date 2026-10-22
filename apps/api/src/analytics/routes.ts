import { Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';

const idSchema = z.string().uuid();
const historyQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const createAnalyticsRouter = (pool: Pool, failureThreshold: number) => {
  const router = Router();

  router.get('/dashboard/summary', async (_request, response, next) => {
    try {
      const result = await pool.query(
        `SELECT s.id, s.name, s.endpoint, s.enabled, s.check_interval_seconds,
          c.checked_at AS last_checked_at, c.duration_ms AS last_duration_ms, c.outcome AS last_outcome,
          COALESCE(f.outcomes, ARRAY[]::text[]) AS recent_outcomes,
          EXISTS(SELECT 1 FROM incidents i WHERE i.server_id = s.id AND i.state = 'open') AS has_open_incident
         FROM mcp_servers s
         LEFT JOIN LATERAL (
           SELECT checked_at, duration_ms, outcome FROM monitoring_checks WHERE server_id = s.id ORDER BY checked_at DESC LIMIT 1
         ) c ON TRUE
         LEFT JOIN LATERAL (
           SELECT array_agg(outcome) AS outcomes FROM (
             SELECT outcome FROM monitoring_checks WHERE server_id = s.id ORDER BY checked_at DESC LIMIT $1
           ) recent
         ) f ON TRUE
         ORDER BY s.created_at DESC`,
        [failureThreshold],
      );
      const servers = result.rows.map((row) => {
        const consecutiveFailures = (row.recent_outcomes as string[]).findIndex(
          (outcome) => outcome === 'success',
        );
        const failures =
          consecutiveFailures === -1
            ? row.recent_outcomes.length
            : consecutiveFailures;
        const status = !row.enabled
          ? 'disabled'
          : !row.last_checked_at
            ? 'unknown'
            : row.last_outcome === 'success'
              ? 'healthy'
              : failures >= failureThreshold
                ? 'down'
                : 'degraded';
        return {
          id: row.id,
          name: row.name,
          endpoint: row.endpoint,
          enabled: row.enabled,
          checkIntervalSeconds: row.check_interval_seconds,
          status,
          lastCheckedAt: row.last_checked_at,
          lastDurationMs: row.last_duration_ms,
          hasOpenIncident: row.has_open_incident,
        };
      });
      const counts = servers.reduce<Record<string, number>>(
        (value, server) => ({
          ...value,
          [server.status]: value[server.status] + 1,
        }),
        { healthy: 0, degraded: 0, down: 0, unknown: 0, disabled: 0 },
      );
      const incidents = await pool.query(
        `SELECT i.id, i.server_id AS "serverId", s.name AS "serverName", i.state, i.summary, i.started_at AS "startedAt", i.resolved_at AS "resolvedAt" FROM incidents i JOIN mcp_servers s ON s.id = i.server_id ORDER BY i.started_at DESC LIMIT 10`,
      );
      response.json({ counts, servers, incidents: incidents.rows });
    } catch (error) {
      next(error);
    }
  });

  router.get('/servers/:id/checks', async (request, response, next) => {
    const id = idSchema.safeParse(request.params.id);
    const query = historyQuery.safeParse(request.query);
    if (!id.success || !query.success)
      return response.status(400).json({ error: 'Invalid history request' });
    try {
      const result = await pool.query(
        `SELECT id, checked_at AS "checkedAt", duration_ms AS "durationMs", outcome, status_code AS "statusCode", error_code AS "errorCode", sanitized_error AS "sanitizedError"
         FROM monitoring_checks WHERE server_id = $1 ORDER BY checked_at DESC LIMIT $2`,
        [id.data, query.data.limit],
      );
      response.json({ checks: result.rows });
    } catch (error) {
      next(error);
    }
  });

  router.get('/servers/:id/incidents', async (request, response, next) => {
    const id = idSchema.safeParse(request.params.id);
    if (!id.success)
      return response.status(400).json({ error: 'Invalid server id' });
    try {
      const result = await pool.query(
        `SELECT id, state, summary, started_at AS "startedAt", resolved_at AS "resolvedAt"
         FROM incidents WHERE server_id = $1 ORDER BY started_at DESC LIMIT 50`,
        [id.data],
      );
      response.json({ incidents: result.rows });
    } catch (error) {
      next(error);
    }
  });

  router.get('/reports/export-csv', async (request, response, next) => {
    try {
      const serverId = request.query.serverId as string | undefined;
      const query = serverId
        ? `SELECT c.id, s.name as server_name, s.endpoint, c.checked_at, c.duration_ms, c.outcome, c.status_code, c.error_code, c.sanitized_error
           FROM monitoring_checks c
           JOIN mcp_servers s ON s.id = c.server_id
           WHERE s.id = $1
           ORDER BY c.checked_at DESC LIMIT 500`
        : `SELECT c.id, s.name as server_name, s.endpoint, c.checked_at, c.duration_ms, c.outcome, c.status_code, c.error_code, c.sanitized_error
           FROM monitoring_checks c
           JOIN mcp_servers s ON s.id = c.server_id
           ORDER BY c.checked_at DESC LIMIT 500`;

      const result = await pool.query(query, serverId ? [serverId] : []);
      const headers = ['Check ID', 'Server Name', 'Endpoint', 'Checked At', 'Duration (ms)', 'Outcome', 'HTTP Status', 'Error Code', 'Sanitized Error'];
      const csvRows = [headers.join(',')];

      for (const row of result.rows) {
        const line = [
          JSON.stringify(row.id || ''),
          JSON.stringify(row.server_name || ''),
          JSON.stringify(row.endpoint || ''),
          JSON.stringify(row.checked_at || ''),
          row.duration_ms ?? '',
          JSON.stringify(row.outcome || ''),
          row.status_code ?? '',
          JSON.stringify(row.error_code || ''),
          JSON.stringify(row.sanitized_error || ''),
        ].join(',');
        csvRows.push(line);
      }

      response.setHeader('Content-Type', 'text/csv');
      response.setHeader('Content-Disposition', 'attachment; filename="mcpulse-telemetry-report.csv"');
      response.send(csvRows.join('\n'));
    } catch (error) {
      next(error);
    }
  });

  return router;
};
