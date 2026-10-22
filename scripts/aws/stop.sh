#!/usr/bin/env bash
#
# aws-stop: stop the running lab resources to stop consuming credits.
#
# Nothing is ever deleted. The database keeps its data and the instance keeps
# its volume, so scripts/aws/resume.sh can bring everything back.
#
#   scripts/aws/stop.sh            # shows the plan and asks for confirmation
#   scripts/aws/stop.sh --yes      # stops without asking (non interactive)
#   scripts/aws/stop.sh --dry-run  # only prints what would happen
#
# Optional overrides:
#   STOP_DATABASE=0  keep the database running (saves a restart, keeps costs)

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

: "${STOP_DATABASE:=1}"
ASSUME_YES=0
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --yes|-y) ASSUME_YES=1 ;;
    --dry-run) DRY_RUN=1 ;;
    *) fail "Unknown option: $arg" ;;
  esac
done

echo "=============================================================="
echo " MCPulse - stop the lab resources"
echo "=============================================================="

require_aws
assert_identity
load_state

DB_ID="${DB_IDENTIFIER}"
DB_STATE="$(aws_ rds describe-db-instances --db-instance-identifier "$DB_ID" \
  --query "DBInstances[0].DBInstanceStatus" --output text 2>/dev/null || echo "missing")"
EC2_ID="$(aws_ ec2 describe-instances --filters "Name=tag:Name,Values=$EC2_NAME" \
  --query "Reservations[].Instances[0].InstanceId" --output text 2>/dev/null || echo "missing")"
EC2_STATE="$(aws_ ec2 describe-instances --instance-ids "$EC2_ID" \
  --query "Reservations[].Instances[0].State.Name" --output text 2>/dev/null || echo "missing")"

echo
echo "Resources that would be affected:"
echo "  RDS  $DB_ID      : $DB_STATE"
echo "  EC2  $EC2_NAME   : $EC2_ID ($EC2_STATE)"
echo
echo "Consequences:"
echo "  * The dashboard is unreachable until scripts/aws/resume.sh is run."
echo "  * A public IPv4 address is released while the instance is stopped, so"
echo "    the address may change on the next start."
echo "  * The database keeps all data, migrations and history."
echo "  * No resource is deleted and no data is destroyed."
echo
echo "Running costs that stop: EC2 instance time and the public IPv4 address."
echo "The stopped database keeps consuming its provisioned storage charge."
echo

if [[ "$DRY_RUN" == "1" ]]; then
  log "Dry run: nothing was changed."
  exit 0
fi

if [[ "$ASSUME_YES" != "1" ]]; then
  read -r -p "Stop these resources? [y/N] " answer
  case "$answer" in
    y|Y|yes|YES) ;;
    *) log "Cancelled. Nothing was changed."; exit 0 ;;
  esac
fi

if [[ "$EC2_STATE" == "running" ]]; then
  log "Stopping the EC2 instance"
  aws_ ec2 stop-instances --instance-ids "$EC2_ID" >/dev/null
  aws_ ec2 wait instance-stopped --instance-ids "$EC2_ID"
  ok "Instance stopped"
else
  log "Instance is already '$EC2_STATE'"
fi

if [[ "$STOP_DATABASE" == "1" && "$DB_STATE" == "available" ]]; then
  log "Stopping the RDS instance"
  aws_ rds stop-db-instance --db-instance-identifier "$DB_ID" >/dev/null
  ok "Stop requested for the database (it takes a few minutes to complete)"
elif [[ "$STOP_DATABASE" != "1" ]]; then
  log "STOP_DATABASE=0: the database keeps running"
else
  log "Database is already '$DB_STATE'"
fi

echo
echo "=============================================================="
echo " Resources stopped. Bring them back with scripts/aws/resume.sh"
echo "=============================================================="
