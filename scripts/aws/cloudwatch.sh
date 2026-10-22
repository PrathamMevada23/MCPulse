#!/usr/bin/env bash
#
# aws-cloudwatch: install and start the CloudWatch Unified Agent on the
# existing instance.
#
# The Learner Lab policy of this account does not allow iam:PassRole, so no
# instance profile can be attached. The agent therefore uses the temporary
# Learner Lab credentials, which the deployment script copies to
# /root/.aws/credentials with mode 600. Those credentials expire with the lab
# session: metric and log delivery stops at that point and resumes only after
# the credentials are refreshed.
#
#   scripts/aws/cloudwatch.sh
#
# Optional overrides:
#   STOP_AGENT=1   stop the agent instead of starting it

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

: "${STOP_AGENT:=0}"
: "${KEY_NAME:=mcpulse-lab}"
: "${KEY_FILE:=${HOME}/.mcpulse/${KEY_NAME}.pem}"
: "${DEPLOY_USER:=ec2-user}"

require_aws
assert_identity
load_state

EC2_INSTANCE_ID="${EC2_INSTANCE_ID:-$(aws_ ec2 describe-instances --filters "Name=tag:Name,Values=$EC2_NAME" \
  --query "Reservations[].Instances[0].InstanceId" --output text 2>/dev/null || echo "missing")}"
[[ "$EC2_INSTANCE_ID" != "missing" && -n "$EC2_INSTANCE_ID" ]] || fail "The instance $EC2_NAME does not exist."

EC2_PUBLIC_IP="${EC2_PUBLIC_IP:-$(aws_ ec2 describe-instances --instance-ids "$EC2_INSTANCE_ID" \
  --query "Reservations[].Instances[0].PublicIpAddress" --output text 2>/dev/null || echo "")}"
[[ -n "$EC2_PUBLIC_IP" && "$EC2_PUBLIC_IP" != "None" ]] || fail "The instance has no public IP address."
[[ -f "$KEY_FILE" ]] || fail "The private key $KEY_FILE is missing."

SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o ConnectTimeout=15)
SSH_TARGET="${DEPLOY_USER}@${EC2_PUBLIC_IP}"

# Amazon Linux 2023 installs the agent under "amazon-cloudwatch-agent", the
# other distributions use "amazoncloudwatch-agent".
AGENT_ROOT=""
for candidate in /opt/aws/amazon-cloudwatch-agent /opt/aws/amazoncloudwatch-agent; do
  if [[ -d "$candidate" ]]; then AGENT_ROOT="$candidate"; break; fi
done

if [[ "$STOP_AGENT" == "1" ]]; then
  log "Stopping the CloudWatch agent"
  ssh "${SSH_OPTS[@]}" -i "$KEY_FILE" "$SSH_TARGET" \
    'sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a stop' || true
  exit 0
fi

log "Installing the CloudWatch agent on $EC2_PUBLIC_IP"
ssh "${SSH_OPTS[@]}" -i "$KEY_FILE" "$SSH_TARGET" <<'REMOTE'
set -euo pipefail
if ! command -v amazon-cloudwatch-agent >/dev/null 2>&1 && [ ! -x /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent ]; then
  sudo dnf install -y -q amazon-cloudwatch-agent || {
    curl -fsSL https://s3.amazonaws.com/amazoncloudwatch-agent/amazonlinux/amd64/latest/amazon-cloudwatch-agent.rpm -o /tmp/cw.rpm
    sudo rpm -U --nodigest /tmp/cw.rpm
    rm -f /tmp/cw.rpm
  }
fi
sudo cp "$HOME/mcpulse/docs/amazon-cloudwatch-agent.json" \
  /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json
sudo chmod 644 /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json
sudo ls -l /root/.aws/credentials
REMOTE

log "Starting the agent"
ssh "${SSH_OPTS[@]}" -i "$KEY_FILE" "$SSH_TARGET" \
  'sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -s -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json'

log "Agent status"
ssh "${SSH_OPTS[@]}" -i "$KEY_FILE" "$SSH_TARGET" \
  'sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -m ec2 -a status'

echo
echo "Expected log groups: /mcpulse/app/containers, /mcpulse/ec2/messages and /mcpulse/ec2/secure"
echo "Check them with: aws logs describe-log-groups --log-group-name-prefix /mcpulse"
