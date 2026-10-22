#!/usr/bin/env bash
#
# aws-allowlist: update the administrator allowlist after the public address
# of the workstation changed.
#
# The campus network moves the egress address (it rotates inside
# 202.179.156.0/24 and can also route through a proxy or Cloudflare), so both
# the security group rule for SSH and the nginx allowlist have to follow it.
#
#   scripts/aws/allowlist.sh
#
# Optional overrides:
#   ADMIN_IP   the address to allow (default: detected automatically)

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

: "${DEPLOY_USER:=ec2-user}"
: "${KEY_NAME:=mcpulse-lab}"
: "${KEY_FILE:=${HOME}/.mcpulse/${KEY_NAME}.pem}"
# Addresses that are always allowed in addition to the detected one: the
# Google Cloud egress addresses observed in the nginx access log and the
# loopback address for diagnostics from the instance itself.
: "${EXTRA_ADMIN_IPS:=34.123.170.104 34.122.147.229 127.0.0.1}"

require_aws
assert_identity
load_state

ADMIN_IP="${ADMIN_IP:-$(curl -fsS -m 10 https://checkip.amazonaws.com 2>/dev/null || true)}"
[[ -n "$ADMIN_IP" ]] || fail "ADMIN_IP could not be detected. Set it explicitly: ADMIN_IP=x.x.x.x scripts/aws/allowlist.sh"

log "Detected public address: $ADMIN_IP"

WEB_SG_ID="$(aws_ ec2 describe-security-groups --filters "Name=group-name,Values=$WEB_SG" \
  --query "SecurityGroups[0].GroupId" --output text 2>/dev/null || true)"
[[ -n "$WEB_SG_ID" && "$WEB_SG_ID" != "None" ]] || fail "The security group $WEB_SG does not exist."

# Replace the managed SSH rules with the current address.
# A rule without a description makes the "contains" filter fail, so the
# description is checked for null first.
OLD_RULES="$(aws_ ec2 describe-security-groups --group-ids "$WEB_SG_ID" \
  --query "SecurityGroups[0].IpPermissions[?FromPort==\`22\`].IpRanges[?Description!=null && contains(Description,'administrator')].CidrIp" \
  --output text 2>/dev/null | tr '\t' '\n' | sed '/^$/d' || true)"
for cidr in $OLD_RULES; do
  if [[ "$cidr" != "$ADMIN_IP/32" ]]; then
    log "Removing the stale SSH rule for $cidr"
    aws_ ec2 revoke-security-group-ingress --group-id "$WEB_SG_ID" \
      --protocol tcp --port 22 --cidr "$cidr" >/dev/null 2>&1 || true
  fi
done
if ! printf '%s\n' "$OLD_RULES" | grep -qx "$ADMIN_IP/32"; then
  log "Allowing SSH from $ADMIN_IP/32"
  if ! aws_ ec2 authorize-security-group-ingress --group-id "$WEB_SG_ID" \
      --ip-permissions "IpProtocol=tcp,FromPort=22,ToPort=22,IpRanges=[{CidrIp=${ADMIN_IP}/32,Description=SSH from administrator}]" >/dev/null 2>&1; then
    # The rule may already exist with a different description.
    if aws_ ec2 describe-security-groups --group-ids "$WEB_SG_ID" \
        --query "SecurityGroups[0].IpPermissions[?FromPort==\`22\`].IpRanges[].CidrIp" --output text 2>/dev/null \
        | tr '\t' '\n' | grep -qx "$ADMIN_IP/32"; then
      log "The rule for $ADMIN_IP/32 is already present"
    else
      fail "The SSH rule for $ADMIN_IP/32 could not be created."
    fi
  fi
fi

# Update the nginx allowlist on the instance.
EC2_INSTANCE_ID="${EC2_INSTANCE_ID:-$(aws_ ec2 describe-instances --filters "Name=tag:Name,Values=$EC2_NAME" \
  --query "Reservations[].Instances[0].InstanceId" --output text 2>/dev/null || true)}"
[[ -n "$EC2_INSTANCE_ID" && "$EC2_INSTANCE_ID" != "missing" ]] || fail "The instance $EC2_NAME does not exist."
EC2_PUBLIC_IP="${EC2_PUBLIC_IP:-$(aws_ ec2 describe-instances --instance-ids "$EC2_INSTANCE_ID" \
  --query "Reservations[].Instances[0].PublicIpAddress" --output text 2>/dev/null || true)}"
[[ -f "$KEY_FILE" ]] || fail "The private key $KEY_FILE is missing."

log "Updating the nginx allowlist on the instance"
printf '%s' "$ADMIN_IP $EXTRA_ADMIN_IPS" | tr ' ' '\n' | sed '/^$/d' | paste -sd' ' - > /tmp/allowlist.txt
scp -q -i "$KEY_FILE" -o StrictHostKeyChecking=accept-new /tmp/allowlist.txt \
  "${DEPLOY_USER}@${EC2_PUBLIC_IP}:/tmp/allowlist.txt"

ssh -i "$KEY_FILE" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 \
  "${DEPLOY_USER}@${EC2_PUBLIC_IP}" 'bash -s' <<'REMOTE'
set -euo pipefail
cd "$HOME/mcpulse"
ALLOWLIST="$(cat /tmp/allowlist.txt)"
sed -i "s|^MCPULSE_ADMIN_IP=.*|MCPULSE_ADMIN_IP=${ALLOWLIST}|" .env
rm -f /tmp/allowlist.txt
grep MCPULSE_ADMIN_IP .env
sudo docker compose -f compose.aws.yaml up -d --force-recreate --no-deps web >/dev/null 2>&1
sleep 10
sudo docker exec mcpulse-aws-web-1 grep -E "^ +allow " /etc/nginx/conf.d/default.conf | sed 's/^ */  /'
REMOTE

ok "Allowlist updated: $ADMIN_IP"
echo "Current public address of the deployment: http://$EC2_PUBLIC_IP"
