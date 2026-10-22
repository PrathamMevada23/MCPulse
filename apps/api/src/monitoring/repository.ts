import type { Pool } from 'pg';
import type {
  CheckResult,
  MonitoringRepository,
  StoredCheck,
} from './types.js';

type CheckRow = {
  id: string;
  server_id: string;
  checked_at: Date;
  duration_ms: number;
  outcome: 'success' | 'failure';
  status_code: number | null;
  error_code: string | null;
  sanitized_error: string | null;
};
const toStored = (row: CheckRow): StoredCheck => ({
  id: row.id,
  serverId: row.server_id,
  checkedAt: row.checked_at.toISOString(),
  durationMs: row.duration_ms,
  outcome: row.outcome,
  statusCode: row.status_code,
  errorCode: row.error_code,
  sanitizedError: row.sanitized_error,
  toolNames: null,
});

export class PostgresMonitoringRepository implements MonitoringRepository {
  constructor(private readonly pool: Pool) {}

  async recordCheck(
    input: CheckResult & { serverId: string; failureThreshold: number },
  ) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<CheckRow>(
        `INSERT INTO monitoring_checks (server_id, duration_ms, outcome, status_code, error_code, sanitized_error)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [
          input.serverId,
          input.durationMs,
          input.outcome,
          input.statusCode,
          input.errorCode,
          input.sanitizedError,
        ],
      );
      const check = toStored(result.rows[0]);
      if (input.outcome === 'success') {
        await client.query(
          `UPDATE incidents SET state = 'resolved', resolved_at = NOW() WHERE server_id = $1 AND state = 'open'`,
          [input.serverId],
        );
      } else {
        const recent = await client.query<{ outcome: 'success' | 'failure' }>(
          'SELECT outcome FROM monitoring_checks WHERE server_id = $1 ORDER BY checked_at DESC LIMIT $2',
          [input.serverId, input.failureThreshold],
        );
        const failuresReached =
          recent.rows.length === input.failureThreshold &&
          recent.rows.every((item) => item.outcome === 'failure');
        if (failuresReached) {
          await client.query(
            `INSERT INTO incidents (server_id, state, summary, triggering_check_id)
             SELECT $1, 'open', 'Consecutive MCP protocol check failures', $2
             WHERE NOT EXISTS (SELECT 1 FROM incidents WHERE server_id = $1 AND state = 'open')`,
            [input.serverId, check.id],
          );
        }
      }
      await client.query('COMMIT');
      return check;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
