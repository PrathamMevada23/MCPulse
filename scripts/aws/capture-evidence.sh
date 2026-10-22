#!/usr/bin/env bash
#
# aws-capture: collect the evidence of the running deployment into a single
# folder, so the state can be shown and archived even after the Learner Lab
# session stops.
#
#   scripts/aws/capture-evidence.sh [output-folder]
#
# Everything is collected with read-only AWS CLI calls plus a few read-only
# commands on the instance. Nothing is created, changed or deleted.

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

require_aws
assert_identity

: "${KEY_FILE:=${HOME}/.mcpulse/mcpulse-lab.pem}"
: "${DEPLOY_USER:=ec2-user}"

# lib.sh enables "set -e"; a single failing read-only call must not abort the
# collection, because the point is to capture as much evidence as possible.
set +e

OUT_DIR="${1:-$HOME/Desktop/mcpulse-evidence-$(date -u +%Y%m%d-%H%M%S)}"
mkdir -p "$OUT_DIR"
cd "$OUT_DIR" || exit 1

log "Collecting evidence into $OUT_DIR"

capture() {
  local file="$1"; shift
  {
    echo "# Command: $*"
    echo "# Captured: $(date -u +%FT%TZ)"
    echo
    "$@" 2>&1
  } > "$file"
  printf '  %-42s %s\n' "$file" "$(wc -c < "$file" | tr -d ' ') bytes"
}

# ------------------------------------------------------------------- identity
capture 01-identity.json aws_ sts get-caller-identity
capture 01-identity.txt env

# ----------------------------------------------------------------------- ec2
capture 02-ec2-instances.json aws_ ec2 describe-instances \
  --filters "Name=tag:Name,Values=$EC2_NAME" \
  --query "Reservations[].Instances[].{id:InstanceId,state:State.Name,type:InstanceType,ami:ImageId,publicIp:PublicIpAddress,az:Placement.AvailabilityZone,subnet:SubnetId,sg:SecurityGroups[].GroupId,iamProfile:IamInstanceProfile.Arn,volumes:BlockDeviceMappings[].Ebs.VolumeId,launchTime:LaunchTime}"
capture 02-ec2-instances.txt aws_ ec2 describe-instances \
  --filters "Name=tag:Name,Values=$EC2_NAME" \
  --query "Reservations[].Instances[].[InstanceId,InstanceType,State.Name,PublicIpAddress,Placement.AvailabilityZone]" --output table
capture 03-ec2-security-groups.json aws_ ec2 describe-security-groups \
  --filters "Name=group-name,Values=$WEB_SG,$DB_SG" \
  --query "SecurityGroups[].{name:GroupName,id:GroupId,vpc:VpcId,description:Description,ingress:IpPermissions[].{protocol:IpProtocol,from:FromPort,to:ToPort,cidr:IpRanges[].CidrIp,peers:UserIdGroupPairs[].GroupId}}"

# ----------------------------------------------------------------------- rds
capture 04-rds-instances.json aws_ rds describe-db-instances \
  --db-instance-identifier "$DB_IDENTIFIER" \
  --query "DBInstances[0].{id:DBInstanceIdentifier,engine:Engine,version:EngineVersion,class:DBInstanceClass,status:DBInstanceStatus,storage:AllocatedStorage,storageType:StorageType,publiclyAccessible:PubliclyAccessible,az:AvailabilityZone,multiAz:MultiAZ,endpoint:Endpoint.Address,port:Endpoint.Port,securityGroups:VpcSecurityGroups[].VpcSecurityGroupId,subnetGroup:DBSubnetGroup.Name,backups:BackupRetentionPeriod,encrypted:StorageEncrypted}"
capture 04-rds-instances.txt aws_ rds describe-db-instances \
  --db-instance-identifier "$DB_IDENTIFIER" \
  --query "DBInstances[0].[DBInstanceIdentifier,Engine,EngineVersion,DBInstanceClass,DBInstanceStatus,AllocatedStorage,PubliclyAccessible,Endpoint.Address]" --output table

# ---------------------------------------------------------------------- vpc
VPC_ID="${VPC_ID:-$(default_vpc_id)}"
capture 05-vpc.json aws_ ec2 describe-vpcs \
  --filters "Name=isDefault,Values=true" \
  --query "Vpcs[0].{id:VpcId,cidr:CidrBlock,state:State,isDefault:IsDefault,igw:InternetGateways[].InternetGatewayId}"
capture 05-subnets.txt aws_ ec2 describe-subnets \
  --filters "Name=vpc-id,Values=$VPC_ID" \
  --query "Subnets[].[SubnetId,AvailabilityZone,CidrBlock,MapPublicIpOnLaunch]" --output table

# ---------------------------------------------------------------- cloudwatch
capture 06-cloudwatch-log-groups.json aws_ logs describe-log-groups \
  --log-group-name-prefix /mcpulse \
  --query "logGroups[].{name:logGroupName,retention:retentionInDays,created:creationTime,bytes:storedBytes}"
capture 06-cloudwatch-log-groups.txt aws_ logs describe-log-groups \
  --log-group-name-prefix /mcpulse \
  --query "logGroups[].[logGroupName,retentionInDays,storedBytes]" --output table
capture 07-cloudwatch-metrics.json aws_ cloudwatch list-metrics --namespace CWAgent \
  --query "Metrics[].{name:MetricName,dimensions:Dimensions[].Value}"
capture 07-cloudwatch-metrics.txt aws_ cloudwatch list-metrics --namespace CWAgent \
  --query "Metrics[].[MetricName,Dimensions[0].Value]" --output text

# --------------------------------------------------------------------- iam
capture 08-iam-instance-profiles.json aws_ iam list-instance-profiles \
  --query "InstanceProfiles[].{name:InstanceProfileName,roles:Roles[].RoleName}"
capture 08-iam-role-labrole.json aws_ iam get-role --role-name LabRole \
  --query "Role.{name:RoleName,arn:Arn,created:CreateDate}"

# ------------------------------------------------------------- key pairs, s3
capture 09-key-pairs.json aws_ ec2 describe-key-pairs \
  --query "KeyPairs[].{name:KeyName,fingerprint:Fingerprint}"
capture 10-s3-buckets.json aws_ s3api list-buckets --query "Buckets[].Name"

# ------------------------------------------------------------- application
PUBLIC_IP="$(aws_ ec2 describe-instances --filters "Name=tag:Name,Values=$EC2_NAME" \
  --query "Reservations[].Instances[0].PublicIpAddress" --output text 2>/dev/null || true)"

if [ -n "$PUBLIC_IP" ] && [ "$PUBLIC_IP" != "None" ]; then
  curl -fsS -m 15 "http://$PUBLIC_IP/health" -o 11-api-health.json 2>/dev/null &&
    echo "  11-api-health.json" || true
  curl -fsS -m 15 "http://$PUBLIC_IP/health/ready" -o 12-api-ready.json 2>/dev/null &&
    echo "  12-api-ready.json" || true
  curl -fsS -m 20 "http://$PUBLIC_IP/api/dashboard/summary" -o 13-dashboard-summary.json 2>/dev/null &&
    echo "  13-dashboard-summary.json" || true
  curl -fsS -m 20 "http://$PUBLIC_IP/api/reports/export-csv" -o 14-telemetry-export.csv 2>/dev/null &&
    echo "  14-telemetry-export.csv" || true
fi

# ------------------------------------------------------- instance internals
if [ -f "$KEY_FILE" ] && [ -n "$PUBLIC_IP" ]; then
  capture 15-instance-containers.txt ssh -i "$KEY_FILE" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 \
    "${DEPLOY_USER}@${PUBLIC_IP}" \
    'cd ~/mcpulse && sudo docker compose -f compose.aws.yaml ps --format "{{.Service}} | {{.Status}} | {{.Ports}}"'
  capture 16-instance-images.txt ssh -i "$KEY_FILE" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 \
    "${DEPLOY_USER}@${PUBLIC_IP}" \
    'sudo docker images --format "{{.Repository}}:{{.Tag}} | {{.Size}}" | head -10'
  capture 17-instance-database-rows.txt ssh -i "$KEY_FILE" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 \
    "${DEPLOY_USER}@${PUBLIC_IP}" \
    'sudo docker exec mcpulse-aws-api-1 node -e "
const {Client}=require(\"pg\");const fs=require(\"fs\");
const ca=fs.readFileSync(\"/etc/ssl/certs/mcpulse/rds-ca-global-bundle.pem\",\"utf8\");
const c=new Client({connectionString:process.env.DATABASE_URL,ssl:{ca,rejectUnauthorized:true}});
c.connect().then(()=>c.query(\"SELECT (SELECT count(*) FROM mcp_servers) servers,(SELECT count(*) FROM monitoring_checks) checks,(SELECT count(*) FROM incidents) incidents,(SELECT count(*) FROM mcp_tools) tools,(SELECT count(*) FROM schema_migrations) migrations\"))
.then(r=>{console.log(JSON.stringify(r.rows[0]));c.end()}).catch(e=>{console.log(\"ERR\",e.message.slice(0,120));process.exit(1)});"'
  capture 18-instance-agent-status.txt ssh -i "$KEY_FILE" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 \
    "${DEPLOY_USER}@${PUBLIC_IP}" \
    'sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -m ec2 -a status'
  capture 19-instance-tls-proof.txt ssh -i "$KEY_FILE" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 \
    "${DEPLOY_USER}@${PUBLIC_IP}" \
    'sudo docker exec mcpulse-aws-api-1 node -e "
const {Client}=require(\"pg\");const fs=require(\"fs\");
const ca=fs.readFileSync(\"/etc/ssl/certs/mcpulse/rds-ca-global-bundle.pem\",\"utf8\");
const c=new Client({connectionString:process.env.DATABASE_URL,ssl:{ca,rejectUnauthorized:true}});
c.connect().then(()=>c.query(\"SELECT current_database() db, current_user usr, version() v\"))
.then(r=>{const x=r.rows[0];console.log(\"database:\",x.db,\"| user:\",x.usr);console.log(\"server:\",x.v.slice(0,60));c.end()})
.catch(e=>{console.log(\"ERR\",e.message.slice(0,120));process.exit(1)});"'
fi

# ------------------------------------------------------------------- summary
{
  echo "MCPulse deployment evidence"
  echo "Captured : $(date -u +%FT%TZ)"
  echo "Account  : $(aws_ sts get-caller-identity --query Account --output text)"
  echo "Region   : $AWS_REGION"
  echo "Instance : $(aws_ ec2 describe-instances --filters "Name=tag:Name,Values=$EC2_NAME" --query "Reservations[].Instances[0].PublicIpAddress" --output text)"
  echo "Database : $(aws_ rds describe-db-instances --db-instance-identifier "$DB_IDENTIFIER" --query "DBInstances[0].Endpoint.Address" --output text)"
  echo
  echo "Files in this folder:"
  ls -1
} > 00-README.txt

ok "Evidence collected in $OUT_DIR"
echo
echo "Copy this folder somewhere safe (it is outside the repository):"
echo "  $OUT_DIR"
