import { Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';

const idSchema = z.string().uuid();

export const createAiAnalysisRouter = (pool: Pool) => {
  const router = Router();

  router.get('/analysis/:serverId', async (request, response, next) => {
    const parsed = idSchema.safeParse(request.params.serverId);
    if (!parsed.success) return response.status(400).json({ error: 'Invalid server ID' });

    try {
      const serverRes = await pool.query('SELECT * FROM mcp_servers WHERE id = $1', [parsed.data]);
      if (serverRes.rowCount === 0) return response.status(404).json({ error: 'Server not found' });
      const server = serverRes.rows[0];

      // Gather telemetry evidence
      const [checksRes, toolsRes, incidentsRes] = await Promise.all([
        pool.query(
          'SELECT checked_at AS "checkedAt", duration_ms AS "durationMs", outcome, status_code AS "statusCode", error_code AS "errorCode", sanitized_error AS "sanitizedError" FROM monitoring_checks WHERE server_id = $1 ORDER BY checked_at DESC LIMIT 20',
          [server.id],
        ),
        pool.query(
          `SELECT name, active,
                  (SELECT outcome FROM tool_monitoring_checks WHERE tool_id = mcp_tools.id ORDER BY checked_at DESC LIMIT 1) AS last_tool_outcome,
                  (SELECT error_code FROM tool_monitoring_checks WHERE tool_id = mcp_tools.id ORDER BY checked_at DESC LIMIT 1) AS last_tool_error,
                  (SELECT sanitized_error FROM tool_monitoring_checks WHERE tool_id = mcp_tools.id ORDER BY checked_at DESC LIMIT 1) AS last_tool_error_detail
           FROM mcp_tools WHERE server_id = $1`,
          [server.id],
        ),
        pool.query(
          'SELECT state, summary, started_at AS "startedAt" FROM incidents WHERE server_id = $1 ORDER BY started_at DESC LIMIT 5',
          [server.id],
        ),
      ]);

      const checks = checksRes.rows;
      const tools = toolsRes.rows;
      const incidents = incidentsRes.rows;

      const totalChecks = checks.length;
      const failCount = checks.filter((c) => c.outcome === 'failure').length;
      const successCount = totalChecks - failCount;
      const slaRate = totalChecks > 0 ? ((successCount / totalChecks) * 100).toFixed(1) : '100.0';
      const avgDuration =
        totalChecks > 0
          ? Math.round(checks.reduce((acc, c) => acc + (c.durationMs || 0), 0) / totalChecks)
          : 0;
      const latestCheck = checks[0];

      const observedFacts: string[] = [];
      const hypotheses: string[] = [];
      const recommendations: string[] = [];

      // 1. DYNAMIC OBSERVED FACTS SPECIFIC TO THIS SERVER
      if (totalChecks === 0) {
        observedFacts.push('No monitoring telemetry has been recorded yet for this endpoint.');
      } else {
        observedFacts.push(
          `Evaluated ${totalChecks} monitoring cycles. Availability SLA is ${slaRate}% with an average latency of ${avgDuration} ms.`,
        );

        if (latestCheck) {
          if (latestCheck.outcome === 'success') {
            observedFacts.push(
              `MCP handshake succeeded with HTTP ${latestCheck.statusCode ?? 200} in ${latestCheck.durationMs} ms.`,
            );
          } else {
            const errDetail = latestCheck.sanitizedError ? ` (${latestCheck.sanitizedError})` : '';
            observedFacts.push(
              `Check failed: Code ${latestCheck.errorCode ?? 'UNKNOWN'}${latestCheck.statusCode ? `, HTTP ${latestCheck.statusCode}` : ''}${errDetail}.`,
            );
          }
        }
      }

      if (tools.length > 0) {
        const failedTools = tools.filter((t) => t.last_tool_outcome === 'failure');
        if (failedTools.length > 0) {
          observedFacts.push(
            `Catalog has ${tools.length} tool(s). ${failedTools.length} tool(s) failed during invocation: ${failedTools.map((t) => t.name).join(', ')}.`,
          );
        } else {
          observedFacts.push(
            `Catalog has ${tools.length} discovered tool(s). All executed tools reported successful outcomes.`,
          );
        }
      } else {
        observedFacts.push('No tools cataloged yet; endpoint requires authentication or tools/list execution.');
      }

      const openIncident = incidents.find((i) => i.state === 'open');
      if (openIncident) {
        observedFacts.push(
          `Active Incident: "${openIncident.summary}" triggered on ${new Date(openIncident.startedAt).toLocaleTimeString()}.`,
        );
      }

      // 2. DYNAMIC ROOT-CAUSE HYPOTHESES SPECIFIC TO THIS SERVER & ENDPOINT
      const endpoint = server.endpoint.toLowerCase();

      if (endpoint.includes('api.githubcopilot.com')) {
        hypotheses.push(
          'GitHub Remote MCP strictly requires a GitHub Personal Access Token (PAT) with repo/copilot scopes. The endpoint rejects anonymous JSON-RPC with 401 Unauthorized.',
        );
      } else if (endpoint.includes('mcp.cloudflare.com')) {
        hypotheses.push(
          'Cloudflare Official MCP mandates an OAuth realm authorization ("user:read account:read"). Unauthenticated initialization is dropped.',
        );
      } else if (endpoint.includes('api.search.brave.com')) {
        hypotheses.push(
          'Brave Search MCP is gated by the Brave Search API subscription token. An unauthenticated handshake is rejected at the edge with HTTP 403.',
        );
      } else if (endpoint.includes('googleapis.com')) {
        if (failCount > 0) {
          hypotheses.push('Google Cloud ESF gateway rejected the call due to quota or missing service account credentials.');
        } else {
          hypotheses.push(
            'Google Cloud MCP endpoint is healthy at the protocol layer. Individual tool executions require Google Workspace OAuth consent tokens.',
          );
        }
      } else if (endpoint.includes('huggingface.co')) {
        if (failCount === 0) {
          hypotheses.push(
            'Provider supports anonymous public Streamable HTTP & SSE access without requiring user tokens. Handshakes and tool execution operate cleanly.',
          );
        } else {
          hypotheses.push('Transient upstream network latency or throttling detected on the public endpoint.');
        }
      } else {
        if (failCount === 0) {
          hypotheses.push('Endpoint is fully responsive and adheres to MCP JSON-RPC 2025-03-26 specifications.');
        } else {
          hypotheses.push('Connection failure or non-200 HTTP response received from the configured endpoint.');
        }
      }

      // 3. TARGETED CLOUD RECOMMENDATIONS
      if (endpoint.includes('api.githubcopilot.com')) {
        recommendations.push(
          'Provide a GitHub token via "Authorization: Bearer ghp_..." in the client headers to monitor private repositories.',
        );
      } else if (endpoint.includes('api.search.brave.com')) {
        recommendations.push(
          'Create a free Brave Search API key and send it as the X-Subscription-Token header so the Brave endpoint accepts the MCP handshake.',
        );
      } else if (endpoint.includes('googleapis.com')) {
        recommendations.push(
          'To test write-access tools (e.g., create_file), attach a valid OAuth bearer token from Google Cloud Console.',
        );
      } else if (avgDuration > 1000) {
        recommendations.push(
          `Average latency is high (${avgDuration} ms). Increase check interval or deploy an AWS agent closer to the provider region.`,
        );
      } else {
        recommendations.push(
          'Maintain regular 60s background checks to monitor long-term availability SLAs and catch sudden outages.',
        );
      }

      response.json({
        serverName: server.name,
        endpoint: server.endpoint,
        analyzedAt: new Date().toISOString(),
        observedFacts,
        hypotheses,
        recommendations,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
};
