import { Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import type { ServerRepository } from '../servers/types.js';

const idSchema = z.string().uuid();

export const createToolsRouter = (
  pool: Pool,
  servers: ServerRepository,
  checker: {
    discoverTools: (server: import('../servers/types.js').McpServer) => Promise<import('../monitoring/types.js').ToolDiscoveryResult>;
    executeTool: (
      server: import('../servers/types.js').McpServer,
      toolName: string,
      args?: Record<string, unknown>,
      validationRules?: Array<{ field?: string; operator?: string; value?: unknown }>,
    ) => Promise<import('../monitoring/types.js').ToolExecutionResult>;
  },
) => {
  const router = Router();

  // POST /api/servers/:id/discover-tools
  router.post('/servers/:id/discover-tools', async (request, response, next) => {
    const idCheck = idSchema.safeParse(request.params.id);
    if (!idCheck.success) {
      return response.status(400).json({ error: 'Invalid server ID' });
    }

    try {
      const server = await servers.findById(idCheck.data);
      if (!server) {
        return response.status(404).json({ error: 'Server not found' });
      }

      const discovery = await checker.discoverTools(server);
      if (!discovery.success) {
        return response.status(502).json({
          error: discovery.error ?? 'Tool discovery failed on remote endpoint',
          durationMs: discovery.durationMs,
        });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        for (const tool of discovery.tools) {
          await client.query(
            `INSERT INTO mcp_tools (server_id, name, description, input_schema, active, last_seen_at, updated_at)
             VALUES ($1, $2, $3, $4, TRUE, NOW(), NOW())
             ON CONFLICT (server_id, name)
             DO UPDATE SET
               description = EXCLUDED.description,
               input_schema = EXCLUDED.input_schema,
               active = TRUE,
               last_seen_at = NOW(),
               updated_at = NOW()`,
            [server.id, tool.name, tool.description ?? null, JSON.stringify(tool.inputSchema ?? {})],
          );
        }

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      const updatedTools = await pool.query(
        `SELECT id, server_id AS "serverId", name, description, input_schema AS "inputSchema",
                active, first_seen_at AS "firstSeenAt", last_seen_at AS "lastSeenAt"
         FROM mcp_tools WHERE server_id = $1 AND active = TRUE ORDER BY name ASC`,
        [server.id],
      );

      response.json({
        durationMs: discovery.durationMs,
        count: updatedTools.rows.length,
        tools: updatedTools.rows,
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/servers/:id/tools
  router.get('/servers/:id/tools', async (request, response, next) => {
    const idCheck = idSchema.safeParse(request.params.id);
    if (!idCheck.success) {
      return response.status(400).json({ error: 'Invalid server ID' });
    }

    try {
      const result = await pool.query(
        `SELECT t.id, t.server_id AS "serverId", t.name, t.description, t.input_schema AS "inputSchema",
                t.active, t.first_seen_at AS "firstSeenAt", t.last_seen_at AS "lastSeenAt",
                c.last_checked_at AS "lastCheckedAt", c.last_duration_ms AS "lastDurationMs",
                c.last_outcome AS "lastOutcome", c.validation_passed AS "lastValidationPassed"
         FROM mcp_tools t
         LEFT JOIN LATERAL (
           SELECT checked_at AS last_checked_at, duration_ms AS last_duration_ms, outcome AS last_outcome, validation_passed
           FROM tool_monitoring_checks
           WHERE tool_id = t.id
           ORDER BY checked_at DESC
           LIMIT 1
         ) c ON TRUE
         WHERE t.server_id = $1
         ORDER BY t.name ASC`,
        [idCheck.data],
      );

      response.json({ tools: result.rows });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/tools/:id/test
  const testPayloadSchema = z.object({
    params: z.record(z.unknown()).default({}),
    validationRules: z
      .array(
        z.object({
          field: z.string().optional(),
          operator: z.string().optional(),
          value: z.unknown().optional(),
        }),
      )
      .default([]),
  });

  router.post('/tools/:id/test', async (request, response, next) => {
    const idCheck = idSchema.safeParse(request.params.id);
    const bodyCheck = testPayloadSchema.safeParse(request.body);

    if (!idCheck.success || !bodyCheck.success) {
      return response.status(400).json({ error: 'Invalid tool test request payload' });
    }

    try {
      const toolRes = await pool.query(
        `SELECT t.id, t.name, t.server_id, s.endpoint, s.enabled
         FROM mcp_tools t
         JOIN mcp_servers s ON s.id = t.server_id
         WHERE t.id = $1`,
        [idCheck.data],
      );

      if (toolRes.rowCount === 0) {
        return response.status(404).json({ error: 'Tool not found' });
      }

      const row = toolRes.rows[0];
      const server = await servers.findById(row.server_id);
      if (!server) {
        return response.status(404).json({ error: 'Associated server not found' });
      }

      const execResult = await checker.executeTool(
        server,
        row.name,
        bodyCheck.data.params,
        bodyCheck.data.validationRules,
      );

      // Record tool check
      const record = await pool.query(
        `INSERT INTO tool_monitoring_checks (
           server_id, tool_id, duration_ms, outcome, status_code, error_code,
           sanitized_error, validation_passed, validation_message, response_summary
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id, checked_at AS "checkedAt"`,
        [
          server.id,
          row.id,
          execResult.durationMs,
          execResult.outcome,
          execResult.statusCode,
          execResult.errorCode,
          execResult.sanitizedError,
          execResult.validationPassed,
          execResult.validationMessage ?? null,
          JSON.stringify(execResult.responseSummary ?? {}),
        ],
      );

      response.json({
        checkId: record.rows[0].id,
        checkedAt: record.rows[0].checkedAt,
        ...execResult,
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/tools/:id/checks
  router.get('/tools/:id/checks', async (request, response, next) => {
    const idCheck = idSchema.safeParse(request.params.id);
    if (!idCheck.success) {
      return response.status(400).json({ error: 'Invalid tool ID' });
    }

    try {
      const result = await pool.query(
        `SELECT id, checked_at AS "checkedAt", duration_ms AS "durationMs", outcome,
                status_code AS "statusCode", error_code AS "errorCode",
                sanitized_error AS "sanitizedError", validation_passed AS "validationPassed",
                validation_message AS "validationMessage"
         FROM tool_monitoring_checks
         WHERE tool_id = $1
         ORDER BY checked_at DESC
         LIMIT 50`,
        [idCheck.data],
      );

      response.json({ checks: result.rows });
    } catch (err) {
      next(err);
    }
  });

  return router;
};
