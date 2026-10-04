#!/usr/bin/env bash
# One-time: create the EC2 server for Constellation with the AWS CLI (v2).
#
#   aws configure                      # once, with your IAM user's access key
#   ./deploy/aws/launch.sh             # prints the public IP and the next command
#
# Creates (idempotent where it can be): an SSH key pair saved to ~/.ssh/<name>.pem, a security
# group open on 80/443 to everyone and 22 to your current IP only, an Ubuntu 24.04 instance with
# Docker installed by cloud-init.sh, and an Elastic IP so the address survives a stop/start.
#
# Override with env vars, e.g. INSTANCE_TYPE=t3.large ./deploy/aws/launch.sh
set -euo pipefail

REGION="${REGION:-ap-east-1}"            # Hong Kong: next to our users. Opt-in region (see below)
NAME="${NAME:-constellation}"
INSTANCE_TYPE="${INSTANCE_TYPE:-t3.xlarge}" # 4 vCPU / 16 GB; t3.large (2 vCPU / 8 GB) also works
DISK_GB="${DISK_GB:-40}"
KEY_NAME="${KEY_NAME:-$NAME}"
KEY_FILE="${KEY_FILE:-$HOME/.ssh/$KEY_NAME.pem}"
HERE="$(cd "$(dirname "$0")" && pwd)"

export AWS_REGION="$REGION" AWS_PAGER=""
aws sts get-caller-identity --query Account --output text >/dev/null \
  || { echo "AWS CLI is not configured: run 'aws configure' first." >&2; exit 1; }

# Hong Kong (and some other regions) must be switched on once per account.
OPT_IN="$(aws ec2 describe-regions --all-regions --region us-east-1 \
  --filters Name=region-name,Values="$REGION" --query 'Regions[0].OptInStatus' --output text)"
if [ "$OPT_IN" = "not-opted-in" ]; then
  echo "Region $REGION is not enabled for this account. Enable it (takes a few minutes), then re-run:" >&2
  echo "  aws account enable-region --region-name $REGION" >&2
  echo "  (or console: account menu -> Account -> AWS Regions -> Asia Pacific (Hong Kong) -> Enable)" >&2
  exit 1
fi

# --- SSH key ---------------------------------------------------------------------------------
if ! aws ec2 describe-key-pairs --key-names "$KEY_NAME" >/dev/null 2>&1; then
  [ -e "$KEY_FILE" ] && { echo "$KEY_FILE exists but AWS has no key '$KEY_NAME'. Move it away or set KEY_NAME." >&2; exit 1; }
  mkdir -p "$(dirname "$KEY_FILE")"
  aws ec2 create-key-pair --key-name "$KEY_NAME" --key-type ed25519 \
    --query KeyMaterial --output text > "$KEY_FILE"
  chmod 600 "$KEY_FILE"
  echo "Created key pair $KEY_NAME -> $KEY_FILE (share it with the team privately, never commit it)"
fi

# --- Security group --------------------------------------------------------------------------
VPC_ID="$(aws ec2 describe-vpcs --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId' --output text)"
SG_ID="$(aws ec2 describe-security-groups --filters Name=group-name,Values="$NAME-web" Name=vpc-id,Values="$VPC_ID" \
  --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || true)"
if [ -z "$SG_ID" ] || [ "$SG_ID" = "None" ]; then
  SG_ID="$(aws ec2 create-security-group --group-name "$NAME-web" --vpc-id "$VPC_ID" \
    --description "Constellation: web to all, SSH to the team" --query GroupId --output text)"
  aws ec2 authorize-security-group-ingress --group-id "$SG_ID" --protocol tcp --port 80 --cidr 0.0.0.0/0 >/dev/null
  aws ec2 authorize-security-group-ingress --group-id "$SG_ID" --protocol tcp --port 443 --cidr 0.0.0.0/0 >/dev/null
fi
MY_IP="$(curl -fsS https://checkip.amazonaws.com | tr -d '[:space:]')"
aws ec2 authorize-security-group-ingress --group-id "$SG_ID" --protocol tcp --port 22 --cidr "$MY_IP/32" >/dev/null 2>&1 \
  && echo "SSH allowed from $MY_IP" || echo "SSH already allowed from $MY_IP"

# --- Instance --------------------------------------------------------------------------------
INSTANCE_ID="$(aws ec2 describe-instances \
  --filters Name=tag:Name,Values="$NAME" Name=instance-state-name,Values=pending,running,stopping,stopped \
  --query 'Reservations[0].Instances[0].InstanceId' --output text)"
if [ -z "$INSTANCE_ID" ] || [ "$INSTANCE_ID" = "None" ]; then
  AMI="$(aws ssm get-parameter \
    --name /aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id \
    --query Parameter.Value --output text)"
  INSTANCE_ID="$(aws ec2 run-instances --image-id "$AMI" --instance-type "$INSTANCE_TYPE" \
    --key-name "$KEY_NAME" --security-group-ids "$SG_ID" \
    --block-device-mappings "DeviceName=/dev/sda1,Ebs={VolumeSize=$DISK_GB,VolumeType=gp3,DeleteOnTermination=true}" \
    --metadata-options HttpTokens=required \
    --user-data "file://$HERE/cloud-init.sh" \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$NAME}]" \
    --query 'Instances[0].InstanceId' --output text)"
  echo "Launched $INSTANCE_ID ($INSTANCE_TYPE, $AMI)"
fi
aws ec2 wait instance-running --instance-ids "$INSTANCE_ID"

# --- Elastic IP ------------------------------------------------------------------------------
IP="$(aws ec2 describe-addresses --filters Name=instance-id,Values="$INSTANCE_ID" --query 'Addresses[0].PublicIp' --output text)"
if [ -z "$IP" ] || [ "$IP" = "None" ]; then
  ALLOC="$(aws ec2 allocate-address --domain vpc \
    --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=$NAME}]" --query AllocationId --output text)"
  aws ec2 associate-address --instance-id "$INSTANCE_ID" --allocation-id "$ALLOC" >/dev/null
  IP="$(aws ec2 describe-addresses --allocation-ids "$ALLOC" --query 'Addresses[0].PublicIp' --output text)"
fi

cat <<EOF

Server: $INSTANCE_ID  ($REGION)
IP:     $IP
SSH:    ssh -i $KEY_FILE ubuntu@$IP

Docker installs itself on first boot (about 2 minutes). Then ship the code from your machine:
  SSH_KEY=$KEY_FILE ./deploy/aws/ship.sh $IP
EOF
