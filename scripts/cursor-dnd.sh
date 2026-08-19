#!/bin/bash
set -exuo pipefail

apt-get install -y --no-install-recommends \
  fuse-overlayfs \
  gnupg \
  iptables

install -m 0755 -d /etc/apt/keyrings
curl --retry 3 --retry-delay 5 -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | gpg --batch --yes --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list

apt-get update -yq
apt-get install -y --no-install-recommends \
  containerd.io \
  docker-buildx-plugin \
  docker-ce \
  docker-ce-cli \
  docker-compose-plugin

# Nested Docker needs fuse-overlayfs and legacy iptables in Cursor's VM: https://cursor.com/docs/cloud-agent/setup#running-docker
update-alternatives --set iptables /usr/sbin/iptables-legacy
update-alternatives --set ip6tables /usr/sbin/ip6tables-legacy
install -m 0755 -d /etc/docker
printf '%s\n' '{' '  "storage-driver": "fuse-overlayfs"' '}' > /etc/docker/daemon.json
