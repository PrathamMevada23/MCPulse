---
description: Deploy or update the MCPulse application on the approved AWS Learner Lab infrastructure
---

Continue the approved MCPulse deployment in AWS. Run the stages in order and
verify each one before starting the next. Never invent a result: if a check
fails, report the exact error and stop.

1. Preconditions
   - Confirm `scripts/aws/audit.sh` succeeds (valid credentials, expected
     account and region). If the credentials are expired, explain how to
     refresh them and stop.
   - Confirm the administrator public IP is still correct. Detect it with
     `curl -fsS https://checkip.amazonaws.com` and compare it with the value in
     the deployment configuration. If it changed, tell the user, because the
     administrator allowlist in nginx must be updated with it.

2. Infrastructure
   - Run `scripts/aws/deploy.sh`. The script is idempotent: it reuses every
     resource that already exists, never replaces the database and never
     changes public access on an existing instance.
   - Report the created or reused resource identifiers: VPC, security groups,
     DB subnet group, RDS instance and endpoint, EC2 instance and public IP.

3. Application
   - The script transfers the sources, writes the production `.env` on the
     instance (mode 600, the password never leaves the instance), downloads
     the RDS CA bundle, runs the migrations and starts the compose stack.
   - Verify: the container list, `GET /health`, `GET /health/ready`, the
     dashboard over `http://<public-ip>` and `GET /api/dashboard/summary`.

4. Application checks
   - Confirm the five seeded providers are present (GitHub, Google Drive,
     Brave Search, Cloudflare, Hugging Face).
   - Confirm the scheduler records checks with real latencies.
   - Confirm tool discovery works for a reachable provider.
   - Confirm the CSV export returns telemetry rows.
   - Confirm the outage simulator opens an incident after three consecutive
     failures and that the incident auto-resolves after recovery.

5. CloudWatch
   - Install and start the CloudWatch agent only if the instance profile grants
     the required permissions. Confirm that log streams arrive in
     `/mcpulse/app/containers` and `/mcpulse/ec2/syslog`. If the permissions
     are missing, report it and continue without the agent.

6. Record the outcome
   - Update `docs/DEPLOYMENT_STATUS.md` with the resource identifiers, the
     verification results, the known limitations and the recovery commands.
   - Never write credentials, tokens or passwords into that document.
