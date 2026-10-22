---
description: Stop the MCPulse lab resources to stop consuming credits (never deletes data)
---

Safely stop the MCPulse lab resources so that no further credits are consumed.

1. Identify first and report before acting:
   - the RDS instance identifier, class, storage size and current status,
   - the EC2 instance id, type, public IP and current status,
   - the security groups, DB subnet group and VPC that stay in place,
   - what each stopping action costs and what it saves.

2. Obtain explicit approval before stopping anything. If the user has not
   approved, present the plan and stop there.

3. Stop only what was approved:
   - EC2: `aws ec2 stop-instances`. A stopped instance keeps its data and its
     root volume. The public IPv4 address is released and a new address may be
     assigned on the next start.
   - RDS: `aws rds stop-db-instance`. The database keeps all data, the
     migration history and the schema. Note that a stopped database still
     incurs the provisioned storage charge, and that AWS restarts a database
     automatically after seven consecutive days of being stopped.

4. Never delete anything: no `delete-db-instance`, no `terminate-instances`,
   no snapshot deletion, no security group or subnet deletion. If the user
   asks for a deletion, explain the consequence and require a separate,
   explicit confirmation for each resource.

5. Confirm the final state by describing the resources again and report the
   result, including how to bring the environment back
   (`scripts/aws/resume.sh`).
