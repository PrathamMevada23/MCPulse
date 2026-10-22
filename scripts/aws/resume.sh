#!/usr/bin/env bash
#
# aws-resume: bring an existing deployment back after a Learner Lab session
# restart.
#
# It NEVER creates infrastructure. If a resource is missing it reports that
# fact and exits; recreating it is the job of deploy.sh.
#
#   scripts/aws/resume.sh
#
# Optional overrides:
#   FORCE_APP_RESTART=1  force a container restart even when the app is healthy

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

: "${FORCE_APP_RESTART:=0}"
: "${KEY_NAME:=mcpulse-lab}"
: "${KEY_FILE:=${HOME}/.mcpulse/${KEY_NAME}.pem}"
: "${DEPLOY_USER:=ec2-user}"

echo "=============================================================="
echo " MCPulse - resume an existing lab deployment"
echo "=============================================================="

# 1. identity, region and credential validity
require_aws
assert_identity
load_state

# 2. discover the current state
DB_ID="${DB_IDENTIFIER}"
DB_STATE="$(aws_ rds describe-db-instances --db-instance-identifier "$DB_ID" \
  --query "DBInstances[0].DBInstanceStatus" --output text 2>/dev/null || echo "missing")"
DB_ENDPOINT="$(aws_ rds describe-db-instances --db-instance-identifier "$DB_ID" \
  --query "DBInstances[0].Endpoint.Address" --output text 2>/dev/null || echo "")"

EC2_ID="$(aws_ ec2 describe-instances --filters "Name=tag:Name,Values=$EC2_NAME" \
  --query "Reservations[].Instances[0].InstanceId" --output text 2>/dev/null || echo "missing")"
EC2_STATE="$(aws_ ec2 describe-instances --instance-ids "$EC2_ID" \
  --query "Reservations[].Instances[0].State.Name" --output text 2>/dev/null || echo "missing")"
EC2_PUBLIC_IP="$(aws_ ec2 describe-instances --instance-ids "$EC2_ID" \
  --query "Reservations[].Instances[0].PublicIpAddress" --output text 2>/dev/null || echo "")"

log "Database $DB_ID: $DB_STATE"
log "Instance $EC2_NAME ($EC2_ID): $EC2_STATE ($EC2_PUBLIC_IP)"

if [[ "$DB_STATE" == "missing" ]]; then
  fail "The database $DB_ID does not exist. Run scripts/aws/deploy.sh to create the environment."
fi
if [[ "$EC2_STATE" == "missing" || "$EC2_ID" == "missing" ]]; then
  fail "The instance $EC2_NAME does not exist. Run scripts/aws/deploy.sh to create the environment."
fi

# 3. start the database first
if [[ "$DB_STATE" == "stopped" || "$DB_STATE" == "stopping" ]]; then
  log "Starting the stopped RDS instance"
  aws_ rds start-db-instance --db-instance-identifier "$DB_ID" >/dev/null
elif [[ "$DB_STATE" != "available" ]]; then
  log "Database is in state '$DB_STATE', waiting for it to become available"
fi

# 4. wait for the database
log "Waiting for the database to become available"
aws_ rds wait db-instance-available --db-instance-identifier "$DB_ID"
ok "Database is available at $DB_ENDPOINT"

# 5. start the instance
if [[ "$EC2_STATE" == "stopped" || "$EC2_STATE" == "shutting-down" ]]; then
  log "Starting the stopped EC2 instance"
  aws_ ec2 start-instances --instance-ids "$EC2_ID" >/dev/null
fi
aws_ ec2 wait instance-running --instance-ids "$EC2_ID"
EC2_PUBLIC_IP="$(aws_ ec2 describe-instances --instance-ids "$EC2_ID" \
  --query "Reservations[].Instances[0].PublicIpAddress" --output text)"
ok "Instance is running at $EC2_PUBLIC_IP"

# 6. verify instance health, database connectivity, container health and endpoint
if [[ -z "$EC2_PUBLIC_IP" || "$EC2_PUBLIC_IP" == "None" ]]; then
  warn "The instance has no public IP address."
  exit 0
fi

SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o ConnectTimeout=15)
if [[ -f "$KEY_FILE" ]]; then
  log "Checking the containers on the instance"
  ssh "${SSH_OPTS[@]}" -i "$KEY_FILE" "${DEPLOY_USER}@${EC2_PUBLIC_IP}" 'bash -s' <<'REMOTE'
set -uo pipefail
cd "$HOME/mcpulse" 2>/dev/null || { echo "the application directory was not found"; exit 0; }

# The containers exit with the instance and Docker does not bring them back
# after an instance stop, so they are started here when they are not running.
RUNNING="$(sudo docker compose -f compose.aws.yaml ps --status running --format "{{.Service}}" 2>/dev/null | tr '\n' ' ')"
echo "running services: ${RUNNING:-none}"
if ! echo "$RUNNING" | grep -q "api"; then
  echo "starting the application containers"
  sudo docker compose -f compose.aws.yaml up -d --no-deps api web 2>&1 | tail -2
  sleep 10
fi
sudo docker compose -f compose.aws.yaml ps --format "{{.Service}} | {{.Status}}" 2>/dev/null
REMOTE
fi

log "Waiting for the application endpoint"
READY=0
for _ in $(seq 1 60); do
  if curl -fsS -m 5 "http://$EC2_PUBLIC_IP/health/ready" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 5
done

if [[ "$READY" != "1" ]]; then
  warn "The application did not become ready in time."
  if [[ -f "$KEY_FILE" ]]; then
    warn "Recent container logs:"
    ssh "${SSH_OPTS[@]}" -i "$KEY_FILE" "${DEPLOY_USER}@${EC2_PUBLIC_IP}" \
      'cd ~/mcpulse && docker compose -f compose.aws.yaml logs --tail 40' || true
  fi
  exit 1
fi

ok "Application is ready"
curl -fsS -m 10 "http://$EC2_PUBLIC_IP/health/ready"; echo

if [[ "$FORCE_APP_RESTART" == "1" && -f "$KEY_FILE" ]]; then
  log "FORCE_APP_RESTART=1: restarting the application containers"
  ssh "${SSH_OPTS[@]}" -i "$KEY_FILE" "${DEPLOY_USER}@${EC2_PUBLIC_IP}" \
    'cd ~/mcpulse && docker compose -f compose.aws.yaml restart'
  sleep 10
fi

# 7. state summary
echo
echo "=============================================================="
echo " Deployment resumed"
echo "=============================================================="
echo " Dashboard : http://$EC2_PUBLIC_IP"
echo " Health    : http://$EC2_PUBLIC_IP/health"
echo " Readiness : http://$EC2_PUBLIC_IP/health/ready"
echo " Database  : $DB_ENDPOINT ($DB_ID, $DB_STATE)"
echo " Instance  : $EC2_ID ($EC2_STATE)"
echo "=============================================================="

EC2_INSTANCE_ID="$EC2_ID"; EC2_PUBLIC_IP="$EC2_PUBLIC_IP"; DB_ENDPOINT="$DB_ENDPOINT"
save_state
