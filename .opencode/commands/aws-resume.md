---
description: Resume the existing MCPulse deployment after a Learner Lab session restart
---

Bring the existing MCPulse lab deployment back online after the Learner Lab
session was restarted. This workflow must never recreate infrastructure.

1. Verify the AWS identity, the region and the validity of the temporary
   credentials. Stop with precise refresh instructions if the credentials are
   expired or if the account or region is not the expected one.

2. Discover the current state: the RDS instance status and endpoint, the EC2
   instance id, state and public IP, the security groups and the DB subnet
   group. Use the identifiers stored in `~/.mcpulse/aws-lab-state.env` when
   they are present, and fall back to discovery by name when they are not.

3. If the RDS instance exists but is stopped, start it first and wait until
   `aws rds wait db-instance-available` succeeds. Never create a new database.

4. If the EC2 instance exists but is stopped, start it and wait until it is
   running.

5. Verify, in this order:
   - the instance is running and has a public IP,
   - the database is available,
   - the containers are up (`docker compose -f compose.aws.yaml ps` over SSH),
   - `GET /health/ready` returns 200 through nginx,
   - `GET /api/dashboard/summary` lists the five seeded providers and the
     scheduler is recording new checks.

6. Restart a service only when the verification shows that it is broken.
   Never rebuild or redeploy the application as part of a resume unless the
   user asks for it.

7. If a resource is genuinely missing, report it and point to
   `scripts/aws/deploy.sh`. Do not recreate it silently.

8. Update `docs/DEPLOYMENT_STATUS.md` with the resume outcome, the current
   resource identifiers and the public IP (the address may change when an
   instance is stopped and started again).
