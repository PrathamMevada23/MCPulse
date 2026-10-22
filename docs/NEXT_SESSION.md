# MCPulse — Handover for the next session

**Written:** 2026-10-21, end of the first deployment session
**State:** deployed, verified, and **stopped** to stop the credit burn.

---

## 1. What to do first tomorrow (3 commands)

```bash
# 1. Refresh the temporary Learner Lab credentials (the previous ones expired).
aws-lab-login

# 2. Bring the deployment back. It never recreates anything.
scripts/aws/resume.sh

# 3. The campus public address changes. Update the SSH rule and the nginx
#    allowlist in one command.
scripts/aws/allowlist.sh

# 4. Resume log and metric shipping with the new credentials.
scripts/aws/cloudwatch.sh
```

`resume.sh` starts the database first, waits for it, starts the instance and
verifies the containers and the endpoint. It prints the **new public address**,
because a stopped instance receives a new public IP.

If the database is still `stopping`, wait a minute and run it again.

---

## 2. Where everything is

| What | Where |
| --- | --- |
| Full status, evidence, limitations | `docs/DEPLOYMENT_STATUS.md` |
| Step-by-step guide | `docs/PROJECT_STATUS_AND_AWS_GUIDE.md` |
| AWS scripts | `scripts/aws/{audit,deploy,resume,stop,cloudwatch,allowlist}.sh` |
| OpenCode commands | `.opencode/commands/{aws-audit,aws-deploy,aws-resume,aws-stop}.md` |
| AWS profile | `~/.aws/credentials` → profile `learnerlab` |
| Database password | `~/.mcpulse/db-password` (0600) |
| Administrative key | `~/.mcpulse/admin-key` (0600) — paste it into the dashboard with the "Set admin key" button |
| SSH private key | `~/.mcpulse/mcpulse-lab.pem` (0600) |
| Resource identifiers | `~/.mcpulse/aws-lab-state.env` |
| Local helper for credentials | `aws-lab-login` (hidden input, verifies afterwards) |

---

## 3. The deployed resources

| Resource | Value |
| --- | --- |
| Account / region | `462854211377` / `us-east-1` |
| EC2 | `i-0059c1813dd3d1ada` — t3.small, Amazon Linux 2023, user `ec2-user` |
| RDS | `mcpulse-db` — PostgreSQL 16.13, db.t3.micro, 20 GB gp3, public access **off** |
| RDS endpoint | `mcpulse-db.cyinxjr3lgjz.us-east-1.rds.amazonaws.com:5432` |
| Security groups | `mcpulse-web-sg` (sg-085f461886a0676f7), `mcpulse-db-sg` (sg-0d74bb805b76e8e0e) |
| VPC | `vpc-09e2f7d67772fdfea` (default) |
| Key pair | `mcpulse-lab` |
| Admin allowlist | `45.64.214.194` (update it in the instance `.env` if the IP changes) |

---

## 4. Verified working

- Dashboard `/`, `/health`, `/health/ready` (database backed), `/api/dashboard/summary`,
  `/api/reports/export-csv` → all 200.
- Five monitored providers, live checks persisted in RDS.
- Tool discovery against Hugging Face returns four real tools.
- Three consecutive failures → **Down + open incident** → recovery →
  **Healthy + incident auto-resolved**. The outage simulator was removed on
  request; registering an unreachable endpoint reproduces the same incident
  lifecycle.
- SSRF guard rejects `169.254.169.254`, private and loopback destinations.
- Write operations are rejected for any address other than the allowlist.
- RDS TLS is verified (chain + hostname); RDS refuses unencrypted connections.
- CloudWatch: four log groups at 7 day retention plus `CWAgent` metrics.

---

## 5. Open points for the next session

1. **CloudWatch log events** only reach CloudWatch through the Docker `awslogs`
   driver. The agent's file plugin follows a single file per wildcard, so the
   agent collects `/var/log/messages` and `/var/log/secure` only.
2. **The public IP changes** every time the instance is stopped and started.
   The administrator allowlist is an IP, so update `MCPULSE_ADMIN_IP` in the
   instance `.env` when the address changes.
3. **The lab's IAM simulation is unreliable.** It reported
   `rds:CreateDBInstance` as `implicitDeny` while the real API allowed it.
   Prove permissions by calling the API.
4. **A custom DB subnet group cannot be created** in this account, so the
   instance uses the default subnet group. The database stays private because
   public access is off and the security group only allows 5432 from the web SG.
5. **The agent has no instance profile** (`iam:PassRole` is denied), so it uses
   the temporary Learner Lab credentials on the instance and stops shipping
   when the lab session ends.
6. **No per-provider credentials.** GitHub, Cloudflare and Brave Search need a
   token, so they are reported as *Down* with a provider specific explanation.
   Adding tokens needs a schema change.
7. The project is **not a Git repository**. Sources are transferred with `tar`
   over SSH; `macOS` AppleDouble files (`._*`) must stay out of the archive.

---

## 6. Cost

A four hour session is roughly **$0.18** (EC2 t3.small, RDS db.t3.micro,
storage, public IPv4). Running continuously for a month is roughly **$33**.
Always finish with `scripts/aws/stop.sh`.
