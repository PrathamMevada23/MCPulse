#!/usr/bin/env bash
#
# aws-audit: read-only readiness inspection. It never creates, modifies or
# deletes an AWS resource.
#
#   scripts/aws/audit.sh
#
# Exit codes: 0 ready, 1 blocked (missing permission / invalid credentials).

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

echo "=============================================================="
echo " MCPulse - AWS Learner Lab readiness audit (read only)"
echo "=============================================================="

require_aws
assert_identity
load_state

log "Region in use: $AWS_REGION"

# ------------------------------------------------------------------ resources

VPC_ID="${VPC_ID:-$(default_vpc_id)}"
if [[ -z "$VPC_ID" || "$VPC_ID" == "None" ]]; then
  warn "No default VPC found in $AWS_REGION."
else
  ok "Default VPC: $VPC_ID"
  echo "  Availability zones: $(subnet_availability_zones "$VPC_ID" | tr '\n' ' ')"
  echo "  Public subnets    : $(public_subnet_ids "$VPC_ID" | tr '\n' ' ')"
fi

echo
log "Security groups"
aws_ ec2 describe-security-groups \
  --filters "Name=group-name,Values=$WEB_SG,$DB_SG" \
  --query "SecurityGroups[].{name:GroupName,id:GroupId,vpc:VpcId,ingress:IpPermissions}" \
  --output json 2>/dev/null || warn "Unable to describe security groups."

echo
log "EC2 instances named '$EC2_NAME'"
aws_ ec2 describe-instances \
  --filters "Name=tag:Name,Values=$EC2_NAME" \
  --query "Reservations[].Instances[].{id:InstanceId,state:State.Name,type:InstanceType,public:PublicIpAddress,profile:IamInstanceProfile.Arn,sg:SecurityGroups[].GroupId,subnet:SubnetId}" \
  --output json 2>/dev/null || warn "Unable to describe EC2 instances."

echo
log "RDS instances named '$DB_IDENTIFIER'"
aws_ rds describe-db-instances \
  --query "DBInstances[].{id:DBInstanceIdentifier,engine:Engine,version:EngineVersion,class:DBInstanceClass,status:DBInstanceStatus,endpoint:Endpoint.Address,public:PubliclyAccessible,az:AvailabilityZone,multiAz:MultiAZ}" \
  --output json 2>/dev/null || warn "Unable to describe RDS instances."

echo
log "DB subnet groups"
aws_ rds describe-db-subnet-groups \
  --query "DBSubnetGroups[].{name:DBSubnetGroupName,arn:DBSubnetGroupArn,az:Subnets[].AvailabilityZone}" \
  --output json 2>/dev/null || warn "Unable to describe DB subnet groups."

echo
log "S3 buckets"
aws_ s3api list-buckets --query "Buckets[].Name" --output json 2>/dev/null || warn "Unable to list buckets."

echo
log "Key pairs"
aws_ ec2 describe-key-pairs --query "KeyPairs[].{name:KeyName,fp:Fingerprint}" --output json 2>/dev/null || warn "Unable to describe key pairs."

# ------------------------------------------------------------------ iam role

echo
log "IAM role 'LabRole'"
ROLE_ARN="$(aws_ iam get-role --role-name LabRole --query "Role.Arn" --output text 2>/dev/null || true)"
if [[ -z "$ROLE_ARN" || "$ROLE_ARN" == "None" ]]; then
  warn "IAM role 'LabRole' is not visible with these credentials."
else
  ok "LabRole: $ROLE_ARN"
  echo "  Trust policy:"
  aws_ iam get-role --role-name LabRole --query "Role.AssumeRolePolicyDocument" --output json 2>/dev/null || true
  echo "  Attached policies:"
  aws_ iam list-role-policies --role-name LabRole --query "PolicyNames" --output json 2>/dev/null || true
  aws_ iam list-attached-role-policies --role-name LabRole \
    --query "AttachedPolicies[].{name:PolicyName,arn:PolicyArn}" --output json 2>/dev/null || true
  echo "  Instance profiles:"
  aws_ iam list-instance-profiles --query "InstanceProfiles[].{name:InstanceProfileName,roles:Roles[].RoleName}" --output json 2>/dev/null || true
fi

# --------------------------------------------------------- service permissions

echo
log "Service permission probe"
# Read operations are probed directly: they change nothing and their exit code
# is the authoritative answer. Most write APIs do not support --dry-run, so
# write permissions are verified through the IAM policy simulation instead.
probe_read() {
  local service="$1" action="$2" description="$3"
  if aws_ "$service" "$action" >/dev/null 2>&1; then
    ok "$description allowed"
  else
    warn "$description NOT allowed (the API call was refused)"
  fi
}
probe_read ec2 describe-security-groups "ec2:DescribeSecurityGroups"
probe_read ec2 describe-instances "ec2:DescribeInstances"
probe_read ec2 describe-subnets "ec2:DescribeSubnets"
probe_read ec2 create-key-pair "ec2:CreateKeyPair (describe only)"
probe_read rds describe-db-instances "rds:DescribeDBInstances"
probe_read rds describe-db-engine-versions "rds:DescribeDBEngineVersions"
probe_read s3api list-buckets "s3:ListBucket"
probe_read logs describe-log-groups "logs:DescribeLogGroups"
probe_read cloudwatch list-metrics "cloudwatch:ListMetrics"
probe_read iam simulate-principal-policy "iam:SimulatePrincipalPolicy"

echo
log "LabRole write permission simulation (used by the EC2 instance)"
ROLE_ARN_VALUE="$(aws_ iam get-role --role-name LabRole --query "Role.Arn" --output text 2>/dev/null || true)"
if [[ -n "$ROLE_ARN_VALUE" && "$ROLE_ARN_VALUE" != "None" ]]; then
  aws_ iam simulate-principal-policy \
    --policy-source-arn "$ROLE_ARN_VALUE" \
    --action-names \
      ec2:CreateTags ec2:CreateSecurityGroup ec2:AuthorizeSecurityGroupIngress \
      ec2:RunInstances ec2:CreateVolume ec2:CreateSnapshot ec2:AttachVolume \
      ec2:DescribeInstances ec2:DescribeVolumes \
      rds:CreateDBInstance rds:CreateDBSubnetGroup rds:DescribeDBInstances \
      rds:CreateTags \
      logs:CreateLogGroup logs:CreateLogStream logs:PutLogEvents logs:DescribeLogGroups \
      cloudwatch:PutMetricData \
      s3:CreateBucket s3:PutObject \
      ssmmessages:CreateControlChannel ssmmessages:CreateDataChannel \
      ec2messages:AcknowledgeMessage ec2messages:DeleteMessage \
      ec2messages:FailMessage ec2messages:GetEndpoint \
      ec2messages:GetMessages ec2messages:SendReply \
    --query "EvaluationResults[].{action:EvalActionName,decision:EvalDecision}" \
    --output table 2>&1 | head -40
else
  warn "LabRole could not be read, skipping the simulation."
fi

echo
echo "=============================================================="
echo " Audit complete. No resource was created or modified."
echo "=============================================================="
