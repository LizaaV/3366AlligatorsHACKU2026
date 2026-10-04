#!/bin/bash
# EC2 user data: runs once, as root, on the first boot of the instance (see launch.sh).
# Installs Docker + the Compose plugin and adds swap, so `ship.sh` can build right away.
set -euxo pipefail

# Docker Engine + Compose plugin (official convenience script, Ubuntu 24.04).
curl -fsSL https://get.docker.com | sh
usermod -aG docker ubuntu
systemctl enable --now docker

# 4 GB swap: the first image build (Python geo wheels + npm) peaks well above idle memory.
if [ ! -f /swapfile ]; then
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# Keep build cache and old images from filling the disk over many redeploys.
cat > /etc/cron.weekly/docker-prune <<'EOF'
#!/bin/sh
docker image prune -af --filter "until=168h" >/dev/null 2>&1 || true
docker builder prune -af --filter "until=168h" >/dev/null 2>&1 || true
EOF
chmod +x /etc/cron.weekly/docker-prune

mkdir -p /opt/constellation && chown ubuntu:ubuntu /opt/constellation
touch /var/lib/cloud/instance/constellation-ready
