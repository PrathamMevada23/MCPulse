#!/usr/bin/env bash
#
# aws-deploy: idempotent provisioning of the MCPulse lab environment and
# deployment of the application.
#
# The script never deletes a resource, never replaces a database and never
# changes public access on an existing instance. It only creates what is
# missing and updates the application in place.
#
#   scripts/aws/deploy.sh
#
# Environment overrides:
#   ADMIN_IP        public IP allowed to reach the application (SSH + admin API)
#   INSTANCE_TYPE   EC2 instance type (default t3.small)
#   DB_CLASS        RDS instance class (default db.t3.micro)
#   APPLY_APP       1 = deploy the application (default), 0 = infrastructure only
#   USE_RDS         1 = require Amazon RDS, 0 = auto (try RDS, fall back to the
#                   containerised PostgreSQL when the lab policy forbids RDS)

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

: "${ADMIN_IP:=$(curl -fsS -m 10 https://checkip.amazonaws.com 2>/dev/null || true)}"
: "${APPLY_APP:=1}"
: "${USE_RDS:=auto}"
: "${KEY_NAME:=mcpulse-lab}"
: "${KEY_FILE:=${HOME}/.mcpulse/${KEY_NAME}.pem}"
: "${SECRETS_DIR:=${HOME}/.mcpulse}"
: "${DEPLOY_USER:=ec2-user}"
: "${AMI_ID:=ami-0856027a77429315a}"   # Amazon Linux 2023 x86_64
# lib.sh declares a default APP_DIR, so it is set explicitly from the deploy
# user. Amazon Linux 2023 uses "ec2-user", Ubuntu uses "ubuntu".
APP_DIR="${APP_DIR_OVERRIDE:-/home/${DEPLOY_USER}/mcpulse}"

[[ -n "$ADMIN_IP" ]] || fail "ADMIN_IP could not be detected. Set it explicitly: ADMIN_IP=x.x.x.x scripts/aws/deploy.sh"

mkdir -p "$SECRETS_DIR"; chmod 700 "$SECRETS_DIR"

echo "=============================================================="
echo " MCPulse - AWS Learner Lab deployment"
echo "=============================================================="
require_aws
assert_identity
load_state

# ------------------------------------------------------------------- network

VPC_ID="${VPC_ID:-$(default_vpc_id)}"
[[ -n "$VPC_ID" && "$VPC_ID" != "None" ]] || fail "No default VPC available in $AWS_REGION."
ok "VPC: $VPC_ID"

AZS="$(subnet_availability_zones "$VPC_ID" | tr '\n' ' ')"
[[ -n "${AZS// /}" ]] || fail "The VPC has no subnets."
read -r -a AZ_ARRAY <<< "$AZS"
log "Availability zones: ${AZ_ARRAY[*]}"

SUBNET_PAIRS="$(discover_subnet_az_pairs "$VPC_ID")" || warn "Only a partial subnet list could be read."

WEB_SG_ID="$(aws_ ec2 describe-security-groups --filters "Name=group-name,Values=$WEB_SG" \
  --query "SecurityGroups[0].GroupId" --output text 2>/dev/null || true)"
if [[ -z "$WEB_SG_ID" || "$WEB_SG_ID" == "None" ]]; then
  log "Creating security group $WEB_SG"
  WEB_SG_ID="$(aws_ ec2 create-security-group --group-name "$WEB_SG" --description "MCPulse web tier" --vpc-id "$VPC_ID" --query "GroupId" --output text)"
  aws_ ec2 create-tags --resources "$WEB_SG_ID" --tags "Key=Name,Value=$WEB_SG"
  ok "Created $WEB_SG ($WEB_SG_ID)"
else
  ok "Reusing $WEB_SG ($WEB_SG_ID)"
fi

ensure_ingress() {
  local group="$1" proto="$2" port="$3" cidr="$4" description="$5"
  if aws_ ec2 describe-security-group-rules --filters "Name=group-id,Values=$group" \
      --query "SecurityGroupRules[?IpProtocol=='$proto' && FromPort==\`$port\`].CidrIpv4" \
      --output text 2>/dev/null | tr '\t' '\n' | grep -qx "$cidr"; then
    log "Rule already present: $proto/$port from $cidr"
    return 0
  fi
  log "Adding rule: $proto/$port from $cidr"
  aws_ ec2 authorize-security-group-ingress --group-id "$group" \
    --ip-permissions "IpProtocol=$proto,FromPort=$port,ToPort=$port,IpRanges=[{CidrIp=$cidr,Description=$description}]" >/dev/null
}

ensure_ingress "$WEB_SG_ID" tcp 80 "0.0.0.0/0" "MCPulse dashboard"
ensure_ingress "$WEB_SG_ID" tcp 443 "0.0.0.0/0" "MCPulse dashboard (TLS)"
ensure_ingress "$WEB_SG_ID" tcp 22 "$ADMIN_IP/32" "SSH from administrator"

DB_SG_ID="$(aws_ ec2 describe-security-groups --filters "Name=group-name,Values=$DB_SG" \
  --query "SecurityGroups[0].GroupId" --output text 2>/dev/null || true)"
if [[ -z "$DB_SG_ID" || "$DB_SG_ID" == "None" ]]; then
  log "Creating security group $DB_SG"
  DB_SG_ID="$(aws_ ec2 create-security-group --group-name "$DB_SG" --description "MCPulse database tier" --vpc-id "$VPC_ID" --query "GroupId" --output text)"
  aws_ ec2 create-tags --resources "$DB_SG_ID" --tags "Key=Name,Value=$DB_SG"
  ok "Created $DB_SG ($DB_SG_ID)"
else
  ok "Reusing $DB_SG ($DB_SG_ID)"
fi

if ! aws_ ec2 describe-security-groups --group-ids "$DB_SG_ID" \
    --query "SecurityGroups[0].IpPermissions[?FromPort==\`5432\`].UserIdGroupPairs[].GroupId" \
    --output text 2>/dev/null | tr '\t' '\n' | grep -qx "$WEB_SG_ID"; then
  log "Allowing PostgreSQL from $WEB_SG_ID to $DB_SG_ID"
  aws_ ec2 authorize-security-group-ingress --group-id "$DB_SG_ID" \
    --protocol tcp --port 5432 --source-group "$WEB_SG_ID" >/dev/null
fi

# ------------------------------------------------------------ db subnet group

DB_SUBNET_GROUP_EXISTS="$(aws_ rds describe-db-subnet-groups --db-subnet-group-name "$DB_SUBNET_GROUP" \
  --query "DBSubnetGroups[0].DBSubnetGroupName" --output text 2>/dev/null || true)"
DB_SUBNET_GROUP_READY=0
if [[ -z "$DB_SUBNET_GROUP_EXISTS" || "$DB_SUBNET_GROUP_EXISTS" == "None" ]]; then
  # One subnet per availability zone, at least two zones are required by RDS.
  SUBNET_IDS=""
  SEEN_AZ=" "
  while read -r subnet az; do
    [[ -n "$subnet" && -n "$az" ]] || continue
    # Portable "already seen" check (bash 3.2 has no associative arrays).
    case "$SEEN_AZ" in *" $az "*) continue ;; esac
    SEEN_AZ="$SEEN_AZ$az "
    SUBNET_IDS="${SUBNET_IDS:+${SUBNET_IDS},}${subnet}"
  done <<< "$SUBNET_PAIRS"

  SUBNET_COUNT="$(printf '%s' "$SUBNET_IDS" | tr ',' '\n' | grep -c '[a-z0-9-]' || true)"
  if [[ "${SUBNET_COUNT:-0}" -ge 2 ]]; then
    log "Creating DB subnet group $DB_SUBNET_GROUP ($SUBNET_COUNT subnets)"
    if aws_ rds create-db-subnet-group --db-subnet-group-name "$DB_SUBNET_GROUP" \
      --db-subnet-group-description "MCPulse database subnets" \
      --subnet-ids "$SUBNET_IDS" >/dev/null 2>"$SECRETS_DIR/db-subnet-group-error.txt"; then
      ok "Created $DB_SUBNET_GROUP"
      DB_SUBNET_GROUP_READY=1
    else
      # Some Learner Lab accounts do not accept the default VPC subnets for a
      # custom DB subnet group. The instance then uses the default subnet group
      # of the default VPC, which is still private because public access is off.
      warn "The DB subnet group could not be created:"
      sed -n '1,3p' "$SECRETS_DIR/db-subnet-group-error.txt" | sed 's/^/    /' >&2
      warn "Continuing with the default subnet group of the default VPC."
    fi
  else
    warn "Only ${SUBNET_COUNT:-0} availability zone(s) could be read, so the DB subnet group is skipped."
    warn "Amazon RDS requires subnets in at least two availability zones."
  fi
else
  ok "Reusing $DB_SUBNET_GROUP"
  DB_SUBNET_GROUP_READY=1
fi

# ------------------------------------------------------------------- database
#
# Amazon RDS is attempted first because it is the target architecture. The
# Learner Lab policy of some accounts denies rds:CreateDBInstance, in which
# case the deployment continues with a PostgreSQL 16 container on the instance
# instead. The fallback is reported explicitly.

DB_MODE="container"
DB_ENDPOINT=""
DB_PORT="5432"
DB_NAME="${DB_NAME:-mcpulse}"
DB_USER="${DB_USER:-mcpulse}"

DB_EXISTS="$(aws_ rds describe-db-instances --db-instance-identifier "$DB_IDENTIFIER" \
  --query "DBInstances[0].DBInstanceIdentifier" --output text 2>/dev/null || true)"

if [[ -n "$DB_EXISTS" && "$DB_EXISTS" != "None" ]]; then
  log "Existing RDS instance $DB_IDENTIFIER found, reusing it (never replaced)"
  DB_MODE="rds"
elif [[ "$USE_RDS" != "0" ]]; then
  DB_PASSWORD_FILE="$SECRETS_DIR/db-password"
  if [[ ! -f "$DB_PASSWORD_FILE" ]]; then
    python3 -c "import secrets;print(secrets.token_urlsafe(24))" > "$DB_PASSWORD_FILE"
    chmod 600 "$DB_PASSWORD_FILE"
  fi
  DB_PASSWORD="$(cat "$DB_PASSWORD_FILE")"
  RDS_SUBNET_ARGS=()
  if [[ "$DB_SUBNET_GROUP_READY" == "1" ]]; then
    RDS_SUBNET_ARGS=(--db-subnet-group-name "$DB_SUBNET_GROUP")
  fi
  log "Attempting to create the RDS instance $DB_IDENTIFIER ($DB_CLASS)"
  if aws_ rds create-db-instance \
      --db-instance-identifier "$DB_IDENTIFIER" \
      --engine postgres \
      --engine-version "$DB_ENGINE_VERSION" \
      --db-instance-class "$DB_CLASS" \
      --allocated-storage "$DB_STORAGE" \
      --storage-type gp3 \
      --storage-encrypted \
      --no-storage-autoscaling \
      --master-username "mcpulse_admin" \
      --master-user-password "$DB_PASSWORD" \
      --db-name "mcpulse" \
      ${RDS_SUBNET_ARGS[@]+"${RDS_SUBNET_ARGS[@]}"} \
      --vpc-security-group-ids "$DB_SG_ID" \
      --no-publicly-accessible \
      --no-multi-az \
      --backup-retention-period 0 \
      --no-deletion-protection \
      --no-copy-tags-to-snapshot \
      --no-enable-performance-insights \
      --auto-minor-version-upgrade >/dev/null 2>"$SECRETS_DIR/rds-create-error.txt"; then
    DB_MODE="rds"
    ok "RDS instance creation accepted"
  else
    warn "Amazon RDS is not available to this account:"
    sed -n '1,6p' "$SECRETS_DIR/rds-create-error.txt" | sed 's/^/    /' >&2
    warn "Falling back to a PostgreSQL 16 container on the EC2 instance."
    DB_MODE="container"
  fi
fi

if [[ "$DB_MODE" == "rds" ]]; then
  log "Waiting for the database to become available (this can take several minutes)"
  aws_ rds wait db-instance-available --db-instance-identifier "$DB_IDENTIFIER"
  DB_ENDPOINT="$(aws_ rds describe-db-instances --db-instance-identifier "$DB_IDENTIFIER" \
    --query "DBInstances[0].Endpoint.Address" --output text)"
  DB_PORT="$(aws_ rds describe-db-instances --db-instance-identifier "$DB_IDENTIFIER" \
    --query "DBInstances[0].Endpoint.Port" --output text)"
  ok "Database endpoint: $DB_ENDPOINT:$DB_PORT"
fi

# --------------------------------------------------------------------- key pair

if [[ ! -f "$KEY_FILE" ]]; then
  if aws_ ec2 describe-key-pairs --key-names "$KEY_NAME" >/dev/null 2>&1; then
    warn "Key pair $KEY_NAME already exists in AWS but $KEY_FILE is missing locally."
    warn "SSH access requires either recovering the private key or using EC2 Instance Connect."
  else
    log "Creating key pair $KEY_NAME"
    aws_ ec2 create-key-pair --key-name "$KEY_NAME" --key-type ed25519 \
      --query "KeyMaterial" --output text > "$KEY_FILE"
    chmod 600 "$KEY_FILE"
    ok "Private key stored at $KEY_FILE (0600)"
  fi
fi

# ------------------------------------------------------------------ ec2 instance

EC2_INSTANCE_ID="$(aws_ ec2 describe-instances --filters "Name=tag:Name,Values=$EC2_NAME" \
  --query "Reservations[].Instances[0].InstanceId" --output text 2>/dev/null || true)"

if [[ -z "$EC2_INSTANCE_ID" || "$EC2_INSTANCE_ID" == "None" ]]; then
  SUBNET_ID="$(public_subnet_in "$VPC_ID" "" || true)"
  [[ -n "$SUBNET_ID" ]] || fail "No public subnet found in $VPC_ID."

  INSTANCE_PROFILE_ARN="$(aws_ iam get-instance-profile --instance-profile-name LabInstanceProfile \
    --query "InstanceProfile.Arn" --output text 2>/dev/null || true)"
  INSTANCE_PROFILE_NAME="LabInstanceProfile"
  if [[ -n "$INSTANCE_PROFILE_ARN" && "$INSTANCE_PROFILE_ARN" != "None" ]]; then
    log "Instance profile LabInstanceProfile is available and will be attached"
  else
    warn "No instance profile is available; the CloudWatch agent will use temporary credentials."
    INSTANCE_PROFILE_ARN=""
  fi

  log "Launching $EC2_NAME ($EC2_TYPE) in subnet $SUBNET_ID"
  RUN_ARGS=(
    --image-id "$AMI_ID"
    --instance-type "$EC2_TYPE"
    --security-group-ids "$WEB_SG_ID"
    --associate-public-ip-address
    --key-name "$KEY_NAME"
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$EC2_NAME}]"
    --metadata-options "HttpTokens=required,HttpEndpoint=enabled"
  )
  PROFILE_ARGS=()
  if [[ -n "$INSTANCE_PROFILE_ARN" ]]; then
    # The CLI expects the profile name, not the ARN.
    PROFILE_ARGS=(--iam-instance-profile "Name=${INSTANCE_PROFILE_NAME}")
  fi

  launch_in_subnet() {
    local subnet="$1"
    aws_ ec2 run-instances "${RUN_ARGS[@]}" --subnet-id "$subnet" ${PROFILE_ARGS[@]+"${PROFILE_ARGS[@]}"} \
      --query "Instances[0].InstanceId" --output text 2>"$SECRETS_DIR/run-instances-error.txt"
  }

  # Not every availability zone offers the requested instance type, so the
  # launch is attempted in each subnet until one is accepted.
  EC2_INSTANCE_ID=""
  LAUNCHED_SUBNET=""
  while read -r subnet az; do
    [[ -n "$subnet" ]] || continue
    log "Attempting to launch in $az ($subnet)"
    if EC2_INSTANCE_ID="$(launch_in_subnet "$subnet")" && [[ -n "$EC2_INSTANCE_ID" ]]; then
      LAUNCHED_SUBNET="$subnet"
      break
    fi
    if [[ ${#PROFILE_ARGS[@]} -gt 0 ]]; then
      warn "The launch with the instance profile was refused:"
      sed -n '1,2p' "$SECRETS_DIR/run-instances-error.txt" | sed 's/^/    /' >&2
      warn "Retrying without an instance profile (the account does not grant iam:PassRole)."
      PROFILE_ARGS=()
      continue
    fi
    sed -n '1,2p' "$SECRETS_DIR/run-instances-error.txt" | sed 's/^/    /' >&2
  done <<< "$SUBNET_PAIRS"

  [[ -n "$EC2_INSTANCE_ID" ]] || fail "The instance could not be launched in any availability zone."
  ok "Launched $EC2_INSTANCE_ID in $LAUNCHED_SUBNET"
else
  ok "Reusing existing instance $EC2_INSTANCE_ID"
  if [[ "$(aws_ ec2 describe-instances --instance-ids "$EC2_INSTANCE_ID" --query "Reservations[].Instances[0].State.Name" --output text)" == "stopped" ]]; then
    log "Starting the stopped instance"
    aws_ ec2 start-instances --instance-ids "$EC2_INSTANCE_ID" >/dev/null
  fi
fi

log "Waiting for the instance to reach the running state"
aws_ ec2 wait instance-running --instance-ids "$EC2_INSTANCE_ID"

# The public address is assigned a moment after the instance starts.
EC2_PUBLIC_IP=""
for _ in $(seq 1 30); do
  EC2_PUBLIC_IP="$(aws_ ec2 describe-instances --instance-ids "$EC2_INSTANCE_ID" \
    --query "Reservations[].Instances[0].PublicIpAddress" --output text 2>/dev/null || true)"
  if [[ -n "$EC2_PUBLIC_IP" && "$EC2_PUBLIC_IP" != "None" ]]; then break; fi
  sleep 5
done
[[ -n "$EC2_PUBLIC_IP" && "$EC2_PUBLIC_IP" != "None" ]] ||
  fail "The instance did not receive a public IP address."
ok "Instance $EC2_INSTANCE_ID is running at $EC2_PUBLIC_IP"

# The instance profile is attached after launch as well, because attaching it
# during RunInstances requires the iam:PassRole permission.
if [[ -n "${INSTANCE_PROFILE_ARN:-}" ]]; then
  if aws_ ec2 associate-iam-instance-profile --instance-id "$EC2_INSTANCE_ID" \
      --iam-instance-profile "$INSTANCE_PROFILE_ARN" >/dev/null 2>&1; then
    ok "Instance profile attached"
  else
    warn "The instance profile could not be attached (iam:PassRole is not granted)."
    warn "The CloudWatch agent will use the temporary Learner Lab credentials instead."
  fi
fi

save_state

if [[ "$APPLY_APP" != "1" ]]; then
  log "APPLY_APP=0: infrastructure only, skipping the application deployment."
  exit 0
fi

# ------------------------------------------------------------------ application

SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o ConnectTimeout=15)
SSH_TARGET="${DEPLOY_USER}@${EC2_PUBLIC_IP}"

log "Waiting for SSH"
for _ in $(seq 1 30); do
  if ssh "${SSH_OPTS[@]}" -i "$KEY_FILE" "$SSH_TARGET" 'true' >/dev/null 2>&1; then break; fi
  sleep 5
done
ssh "${SSH_OPTS[@]}" -i "$KEY_FILE" "$SSH_TARGET" 'true' 2>/dev/null ||
  fail "SSH to $SSH_TARGET is not possible. Check the key pair and the security group rule for $ADMIN_IP."

log "Bootstrapping the instance (Amazon Linux 2023)"
ssh "${SSH_OPTS[@]}" -i "$KEY_FILE" "$SSH_TARGET" <<'REMOTE'
set -euo pipefail
sudo dnf install -y -q tar openssl
if ! sudo dnf install -y -q docker; then
  curl -fsSL https://get.docker.com | sudo sh
fi
sudo systemctl enable --now docker

# Docker Compose v2 plugin
sudo mkdir -p /usr/local/lib/docker/cli-plugins
if ! docker compose version >/dev/null 2>&1; then
  sudo curl -fsSL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64" \
    -o /usr/local/lib/docker/cli-plugins/docker-compose
  sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
fi

# The Amazon Linux package ships an old buildx that "docker compose build"
# refuses to use, so a current buildx is installed.
if ! docker buildx version >/dev/null 2>&1 || ! docker buildx version 2>&1 | grep -q "0\.1[7-9]\|0\.2[0-9]\|0\.3[0-9]"; then
  sudo curl -fsSL "https://github.com/docker/buildx/releases/download/v0.17.1/buildx-v0.17.1.linux-amd64" \
    -o /usr/local/lib/docker/cli-plugins/docker-buildx
  sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-buildx
fi

# 2 GB swap so the image build cannot exhaust the 2 GB of RAM
if ! swapon --show | grep -q /swapfile; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile swap swap defaults 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

sudo usermod -aG docker "$(whoami)"
docker --version
docker compose version
free -h | head -2
REMOTE

log "Transferring the application sources"
# COPYFILE_DISABLE and --no-xattrs stop macOS from adding AppleDouble sidecar
# files ("._name") to the archive. Those files are binary metadata and would
# otherwise be deployed next to the real sources.
COPYFILE_DISABLE=1 tar --no-xattrs \
    --exclude='./node_modules' --exclude='*/node_modules' --exclude='./dist' \
    --exclude='*/dist' --exclude='./.git' --exclude='./.env' --exclude='./.DS_Store' \
    --exclude='./certs' --exclude='._*' --exclude='*/._*' \
    -czf - . | ssh "${SSH_OPTS[@]}" -i "$KEY_FILE" "$SSH_TARGET" \
    "mkdir -p $APP_DIR && tar -xzf - -C $APP_DIR && find $APP_DIR -name '._*' -delete && echo 'sources transferred'"

# The database password and the Learner Lab credentials are generated or read
# locally and piped to the instance. They are never written into the repository.
DB_PASSWORD="$(cat "$SECRETS_DIR/db-password" 2>/dev/null || python3 -c "import secrets;print(secrets.token_urlsafe(24))")"
printf '%s' "$DB_PASSWORD" > "$SECRETS_DIR/db-password"; chmod 600 "$SECRETS_DIR/db-password"

# The administrative key authorizes every state changing API operation. It is
# generated once and kept, so a redeploy does not invalidate the key that is
# already stored in the browser.
ADMIN_KEY_FILE="$SECRETS_DIR/admin-key"
if [ ! -f "$ADMIN_KEY_FILE" ]; then
  python3 -c "import secrets;print(secrets.token_urlsafe(24))" > "$ADMIN_KEY_FILE"
  chmod 600 "$ADMIN_KEY_FILE"
fi
ADMIN_KEY_VALUE="$(cat "$ADMIN_KEY_FILE")"

# Temporary Learner Lab credentials for the CloudWatch agent. They expire with
# the lab session, which is documented as a limitation.
AWS_ACCESS_KEY_ID_VALUE="$(aws configure get aws_access_key_id --profile "$AWS_PROFILE")"
AWS_SECRET_ACCESS_KEY_VALUE="$(aws configure get aws_secret_access_key --profile "$AWS_PROFILE")"
AWS_SESSION_TOKEN_VALUE="$(aws configure get aws_session_token --profile "$AWS_PROFILE")"

log "Writing the production configuration on the instance (secrets stay on the instance)"

# The .env file is rendered locally and piped over SSH. The secret therefore
# never appears in a command line or in the remote process list.
if [[ "$DB_MODE" == "rds" ]]; then
  ENV_CONTENT="$(cat <<ENV
NODE_ENV=production
PORT=3001
HOST=0.0.0.0
CORS_ORIGIN=http://${EC2_PUBLIC_IP}
DATABASE_URL=postgresql://mcpulse_admin:${DB_PASSWORD}@${DB_ENDPOINT}:${DB_PORT}/mcpulse
ADMIN_API_KEY=${ADMIN_KEY_VALUE}
CHECK_TIMEOUT_MS=10000
INCIDENT_FAILURE_THRESHOLD=3
RDS_CA_BUNDLE_PATH=/etc/ssl/certs/mcpulse/rds-ca-global-bundle.pem
MCPULSE_ADMIN_IP=${ADMIN_IP}
ENV
)"
else
  ENV_CONTENT="$(cat <<ENV
NODE_ENV=production
PORT=3001
HOST=0.0.0.0
CORS_ORIGIN=http://${EC2_PUBLIC_IP}
POSTGRES_DB=${DB_NAME}
POSTGRES_USER=${DB_USER}
POSTGRES_PASSWORD=${DB_PASSWORD}
DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@postgres:5432/${DB_NAME}
DATABASE_TLS_CA_PATH=/etc/ssl/certs/mcpulse/pg/ca.crt
ADMIN_API_KEY=${ADMIN_KEY_VALUE}
CHECK_TIMEOUT_MS=10000
INCIDENT_FAILURE_THRESHOLD=3
MCPULSE_ADMIN_IP=${ADMIN_IP}
ENV
)"
fi

printf '%s\n' "$ENV_CONTENT" | ssh "${SSH_OPTS[@]}" -i "$KEY_FILE" "$SSH_TARGET" \
  'mkdir -p "$HOME/mcpulse/certs/pg" && cat > "$HOME/mcpulse/.env" && chmod 600 "$HOME/mcpulse/.env"'

# Temporary Learner Lab credentials for the CloudWatch agent (root owned).
if [[ -n "$AWS_ACCESS_KEY_ID_VALUE" ]]; then
  {
    echo '[default]'
    echo "aws_access_key_id = $AWS_ACCESS_KEY_ID_VALUE"
    echo "aws_secret_access_key = $AWS_SECRET_ACCESS_KEY_VALUE"
    echo "aws_session_token = $AWS_SESSION_TOKEN_VALUE"
  } | ssh "${SSH_OPTS[@]}" -i "$KEY_FILE" "$SSH_TARGET" \
    'sudo mkdir -p /root/.aws && sudo tee /root/.aws/credentials >/dev/null && sudo chmod 600 /root/.aws/credentials'
  {
    echo '[default]'
    echo "region = $AWS_REGION"
    echo 'output = json'
  } | ssh "${SSH_OPTS[@]}" -i "$KEY_FILE" "$SSH_TARGET" \
    'sudo tee /root/.aws/config >/dev/null && sudo chmod 600 /root/.aws/config'
fi

ssh "${SSH_OPTS[@]}" -i "$KEY_FILE" "$SSH_TARGET" 'bash -s' <<REMOTE
set -euo pipefail
cd "\$HOME/mcpulse"
mkdir -p certs/pg
if [ "${DB_MODE}" = "container" ]; then
  if [ ! -s certs/pg/server.crt ]; then
    openssl req -new -x509 -days 3650 -nodes -text -out certs/pg/ca.crt -keyout certs/pg/ca.key \
      -subj "/CN=MCPulse PostgreSQL CA" >/dev/null 2>&1
    openssl req -new -nodes -newkey rsa:2048 -keyout certs/pg/server.key -out certs/pg/server.csr \
      -subj "/CN=postgres" >/dev/null 2>&1
    printf "subjectAltName=DNS:postgres,DNS:localhost,IP:127.0.0.1\n" > certs/pg/san.cnf
    openssl x509 -req -in certs/pg/server.csr -CA certs/pg/ca.crt -CAkey certs/pg/ca.key \
      -CAcreateserial -out certs/pg/server.crt -days 3650 -extfile certs/pg/san.cnf >/dev/null 2>&1
  fi
  chmod 644 certs/pg/ca.crt certs/pg/server.crt
  chmod 600 certs/pg/server.key certs/pg/ca.key
fi
if [ "${DB_MODE}" = "rds" ]; then
  curl -fsSL https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem -o certs/rds-ca-global-bundle.pem
  chmod 644 certs/rds-ca-global-bundle.pem
fi
REMOTE

if [[ "$DB_MODE" == "container" ]]; then
  log "Starting the database container"
  ssh "${SSH_OPTS[@]}" -i "$KEY_FILE" "$SSH_TARGET" \
    'cd "$HOME/mcpulse" && docker compose -f compose.aws.yaml up -d postgres'
  log "Waiting for the database to become healthy"
  for _ in $(seq 1 40); do
    state="$(ssh "${SSH_OPTS[@]}" -i "$KEY_FILE" "$SSH_TARGET" \
      'cd "$HOME/mcpulse" && docker compose -f compose.aws.yaml ps --format json postgres 2>/dev/null | head -1' || true)"
    if [[ "$state" == *'"Health":"healthy"'* || "$state" == *'"Health":"healthy"'* ]]; then break; fi
    sleep 5
  done
fi

log "Running database migrations"
# --build is required: "compose run" reuses an existing image and would
# otherwise migrate with a stale build of the API.
if [[ "$DB_MODE" == "rds" ]]; then
  ssh "${SSH_OPTS[@]}" -i "$KEY_FILE" "$SSH_TARGET" \
    'cd "$HOME/mcpulse" && docker compose -f compose.aws.yaml run --rm --build --no-deps api node apps/api/dist/db/migrate.js'
else
  ssh "${SSH_OPTS[@]}" -i "$KEY_FILE" "$SSH_TARGET" \
    'cd "$HOME/mcpulse" && docker compose -f compose.aws.yaml run --rm --build api node apps/api/dist/db/migrate.js'
fi

log "Starting the application"
if [[ "$DB_MODE" == "rds" ]]; then
  ssh "${SSH_OPTS[@]}" -i "$KEY_FILE" "$SSH_TARGET" \
    'cd "$HOME/mcpulse" && docker compose -f compose.aws.yaml up -d --build --no-deps api web'
else
  ssh "${SSH_OPTS[@]}" -i "$KEY_FILE" "$SSH_TARGET" \
    'cd "$HOME/mcpulse" && docker compose -f compose.aws.yaml up -d --build'
fi

log "Waiting for the API readiness probe"
READY=0
for _ in $(seq 1 60); do
  if curl -fsS -m 5 "http://$EC2_PUBLIC_IP/health/ready" >/dev/null 2>&1; then READY=1; break; fi
  sleep 5
done

if [[ "$READY" != "1" ]]; then
  warn "The application did not become ready in time. Recent logs:"
  ssh "${SSH_OPTS[@]}" -i "$KEY_FILE" "$SSH_TARGET" \
    'cd "$HOME/mcpulse" && docker compose -f compose.aws.yaml logs --tail 60' || true
  exit 1
fi

ok "The application is ready"

echo
echo "=============================================================="
echo " Deployment finished (database mode: $DB_MODE)"
echo "=============================================================="
echo " Dashboard : http://$EC2_PUBLIC_IP"
echo " Health    : http://$EC2_PUBLIC_IP/health"
echo " Readiness : http://$EC2_PUBLIC_IP/health/ready"
echo " Instance  : $EC2_INSTANCE_ID"
echo "=============================================================="
