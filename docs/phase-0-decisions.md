# Phase 0 Decision Record

This record is intentionally incomplete. It lists the decisions that must be verified before monitoring or cloud deployment work begins.

## Confirmed scope

- MCPulse monitors remotely reachable MCP servers.
- Local stdio-only monitoring and AI-client tool-call interception are out of scope.
- AWS provisioning requires explicit approval after Learner Lab access is verified.

## MCP test server decision

### Selected target: DeepWiki public MCP server

| Field                  | Confirmed value                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------ |
| Endpoint               | `https://mcp.deepwiki.com/mcp`                                                                               |
| Provider documentation | `https://mcp.deepwiki.com/`                                                                                  |
| Transport              | Streamable HTTP                                                                                              |
| Authentication         | None documented for public repositories; private-repository access uses a separate endpoint and bearer token |
| Verified on            | 2026-09-27                                                                                                   |
| Initialization result  | HTTP 200; `text/event-stream`; MCP protocol version `2025-03-26`; server name `DeepWiki`, version `2.14.3`   |
| Tool discovery result  | HTTP 200; three public tools returned: `ask_wiki_question`, `read_wiki_contents`, and `read_wiki_structure`  |

The verification used bounded `initialize` and `tools/list` JSON-RPC requests only. It did not call a tool, send credentials, or persist a session. The monitoring engine should first run `initialize` as the protocol health check, measure its full request duration, and optionally run `tools/list` as metadata discovery. It must accept both JSON and request-scoped SSE responses.

### Rejected target: OpenMCP Korea Weather

The documented endpoint `https://mcp.open-mcp.org/api/server/korea-weather@latest/mcp` was reachable on 2026-09-27 but returned HTTP 500 with the JSON-RPC error `Failed to initialize McpServer instance.` It is not suitable as the initial healthy demo target. It can inform an outage/failure test only if its behavior is rechecked at that time.

## Pending decisions

| Decision                                                                           | Status                                     | Required before     |
| ---------------------------------------------------------------------------------- | ------------------------------------------ | ------------------- |
| Remote MCP endpoint and transport                                                  | Confirmed: DeepWiki public Streamable HTTP | MCP checker         |
| Exact timeout, retry and accepted protocol-version policy                          | Unconfirmed                                | MCP checker         |
| Endpoint authentication and secret handling                                        | Unconfirmed                                | MCP checker         |
| AWS Learner Lab services, regions, budget and session limits                       | Unconfirmed                                | Deployment work     |
| Deployment topology                                                                | Unconfirmed                                | Deployment work     |
| Management-route authentication for the demo                                       | Unconfirmed                                | Server registry API |
| Default interval, timeout, degraded threshold, failure threshold and recovery rule | Unconfirmed                                | Monitoring engine   |

## Monitoring rules selected for the local prototype

| Setting              | Value                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------ |
| Check protocol       | Streamable HTTP `initialize`, using protocol version `2025-03-26`                          |
| Check timeout        | 10 seconds (`CHECK_TIMEOUT_MS`)                                                            |
| Default interval     | 60 seconds; allowed range is 30–3600 seconds                                               |
| Scheduler evaluation | Every 10 seconds                                                                           |
| Incident threshold   | 3 consecutive failures (`INCIDENT_FAILURE_THRESHOLD`)                                      |
| Recovery rule        | First successful subsequent check resolves any open incident                               |
| Slow-response status | Not implemented yet; response duration is recorded but no separate threshold is configured |

The manual-check management route is local development only until the authentication approach is selected. It must not be publicly exposed in a deployment.
