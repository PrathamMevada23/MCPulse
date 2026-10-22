# MCPulse

MCPulse is a Cloud Computing course project for monitoring remotely reachable MCP servers. It records availability and response-time checks, presents historical status, and manages incidents. This repository currently contains the Phase 1 local foundation only.

## Current scope

- React, TypeScript, Tailwind CSS dashboard shell
- Express, TypeScript API with `GET /health`
- Environment validation, CORS restriction, linting, formatting, and an API test
- PostgreSQL schema migrations and server-registry CRUD API
- Streamable HTTP protocol checks, scheduled checks, check persistence, and incident recovery rules
- No AWS deployment or credentials from the application yet

## Prerequisites

- Node.js 22 or later
- npm 10 or later

## Local setup

```bash
cp .env.example .env
npm install
npm run db:up
npm run db:migrate
npm run dev
```

Open `http://localhost:5173`. The API health endpoint is `http://127.0.0.1:3001/health`.

`db:up` starts PostgreSQL only on your local loopback address. The compose password is a local development credential and must not be reused outside this repository.

## Verification

```bash
npm run lint
npm test
npm run build
```

## Server registry API

Read-only routes are public. Every state changing route is an administrative
operation: in a deployment it is reachable only from the administrator address
(the nginx `MCPULSE_ADMIN_IP` allowlist), and it can additionally require the
`ADMIN_API_KEY` header when that variable is configured.

| Method   | Route                              | Purpose                                                                      |
| -------- | ---------------------------------- | ---------------------------------------------------------------------------- |
| `GET`    | `/api/servers`                     | List configured servers                                                      |
| `POST`   | `/api/servers`                     | Create a Streamable HTTP server configuration                                |
| `GET`    | `/api/servers/:id`                 | Get one configuration                                                        |
| `PATCH`  | `/api/servers/:id`                 | Update name, endpoint, enabled state, or interval                            |
| `DELETE` | `/api/servers/:id`                 | Delete a configuration and its dependent history                             |
| `POST`   | `/api/servers/:id/check-now`       | Run one protocol check (administrative)                                      |
| `POST`   | `/api/servers/:id/simulate-outage` | Engage or clear the chaos outage simulation (administrative)                 |
| `POST`   | `/api/servers/:id/discover-tools`  | Discover the MCP tool catalogue (administrative)                             |
| `GET`    | `/api/dashboard/summary`           | Dashboard status counts, servers, and recent incidents                       |
| `GET`    | `/api/servers/:id/checks?limit=50` | Bounded check history for a server                                           |
| `GET`    | `/api/servers/:id/incidents`       | Incident history for a server                                                |
| `GET`    | `/health`                          | Liveness probe (does not touch the database)                                 |
| `GET`    | `/health/ready`                    | Readiness probe (verifies the PostgreSQL connection)                         |

The migrations create `mcp_servers`, `monitoring_checks`, `incidents`,
`mcp_tools`, `tool_test_profiles`, `tool_monitoring_checks` and
`tool_incidents`. Migration `003` seeds the five monitored providers: GitHub,
Google Drive, Brave Search, Cloudflare and Hugging Face.

## Monitoring rules

- The scheduler evaluates enabled servers every 10 seconds and starts a check only when their configured interval is due. It prevents overlapping checks for one server.
- A check sends the Streamable HTTP MCP `initialize` request, uses `CHECK_TIMEOUT_MS` (10 seconds by default), measures full response time, and accepts JSON or request-scoped SSE responses.
- `Unknown` means no stored check. A successful check is `Healthy`. A failed check is `Degraded` until it reaches `INCIDENT_FAILURE_THRESHOLD` consecutive failures (3 by default), then it is `Down` and an incident opens.
- The first later successful check resolves the open incident and restores `Healthy`.
- Only sanitized error summaries are stored. MCP tool calls are never made by the health checker.

## Local database lifecycle

```bash
npm run db:up
npm run db:migrate
npm run db:down
```

`db:down` stops the local container but preserves the named Docker volume. Use Docker Desktop to remove that volume only when you deliberately want to discard local development data.

## Safety and deployment gates

- Never commit `.env` files, credentials, authorization headers, or endpoint secrets.
- Monitored endpoints are the five seeded remote providers (GitHub, Google Drive, Brave Search, Cloudflare, Hugging Face). No third-party MCP server is installed or self-hosted.
- Endpoints that resolve to loopback, private, link-local or cloud metadata addresses are rejected by the SSRF guard.
- AWS resources are only created by the approved deployment scripts, and the scripts never delete a database, an instance or any stored data.

See [the Phase 0 decision record](docs/phase-0-decisions.md), [local architecture](docs/architecture.md), [the deployment status and recovery notes](docs/DEPLOYMENT_STATUS.md), and the [AWS Cloud Deployment Plan](docs/aws-deployment-plan.md).

## AWS Cloud Deployment

MCPulse runs on AWS Learner Lab infrastructure:
- **Compute:** Amazon EC2 (`t3.small`) running the production web and API containers with Docker Compose.
- **Database:** Amazon RDS PostgreSQL 16, private, `db.t3.micro`, 20 GB gp3, verified TLS.
- **Observability:** Amazon CloudWatch logs and metrics through the CloudWatch Unified Agent.
- **Security:** the existing `LabRole` instance profile, `mcpulse-web-sg` / `mcpulse-db-sg`, an API port bound to loopback, and an administrator allowlist in nginx for every state changing API route.

Repeatable workflows (also available as the OpenCode commands `/aws-audit`,
`/aws-deploy`, `/aws-resume` and `/aws-stop`):

```bash
scripts/aws/audit.sh     # read-only readiness inspection
scripts/aws/deploy.sh    # create or update the environment and the application
scripts/aws/resume.sh    # resume an existing deployment after a lab restart
scripts/aws/stop.sh      # stop the resources to reduce cost (asks first)
```

Full step-by-step provisioning instructions are in
[docs/PROJECT_STATUS_AND_AWS_GUIDE.md](docs/PROJECT_STATUS_AND_AWS_GUIDE.md).

Current deployment state, resource identifiers, verification evidence and the
known limitations are in
[docs/DEPLOYMENT_STATUS.md](docs/DEPLOYMENT_STATUS.md). The handover notes for
the next session are in [docs/NEXT_SESSION.md](docs/NEXT_SESSION.md).

| Document | Purpose |
| --- | --- |
| [docs/AWS_ARCHITECTURE_AND_DATA_FLOW.md](docs/AWS_ARCHITECTURE_AND_DATA_FLOW.md) | Every AWS service, why it is used, how the data flows, what to screenshot |
| [docs/PROJECT_REPORT.md](docs/PROJECT_REPORT.md) | The academic project report (poster ready) |
| [docs/DEMONSTRATION_GUIDE.md](docs/DEMONSTRATION_GUIDE.md) | How to present the project to the professor, step by step |
