---
description: Inspect AWS Learner Lab readiness for MCPulse without changing any resource
---

Run the MCPulse AWS readiness audit. This is strictly read only: it must not
create, modify or delete any AWS resource, and it must not deploy anything.

Steps:

1. Run `scripts/aws/audit.sh` from the repository root. It uses the local
   `learnerlab` AWS CLI profile and the region configured for that profile.
2. If the script reports that the credentials are invalid or expired, stop and
   explain exactly how to refresh the temporary Learner Lab credentials
   (`aws configure --profile learnerlab` and
   `aws configure set aws_session_token <TOKEN> --profile learnerlab`). Never
   ask the user to paste credentials into the conversation.
3. Summarise for the user:
   - the active AWS identity, account id and region (and flag any mismatch with
     the expected account or region instead of silently continuing),
   - the default VPC, its availability zones and its public subnets,
   - the existing security groups, EC2 instances, RDS instances, DB subnet
     groups, S3 buckets and key pairs,
   - the `LabRole` role, its trust policy, attached policies and instance
     profiles,
   - the result of every service permission probe,
   - whether the environment is ready for `aws-deploy`.
4. State clearly that no resource was changed.
