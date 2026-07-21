#!/bin/bash
set -exuo pipefail

export WORKSPACE_ROOT=/workspaces/astralbeam

# Install common development tools
export ARCH=$(dpkg --print-architecture)
export DEBIAN_FRONTEND=noninteractive
apt-get update -yq
apt-get dist-upgrade -yq
apt-get install -y --no-install-recommends \
  build-essential libatomic1 ca-certificates locales lsb-release tzdata \
  curl wget\
  git \
  zsh \
  vim nano \
  iputils-ping net-tools procps openssh-client \
  fontconfig pkg-config python3 \
  liburing-dev

# Autoload defaults.env into login shells
DEFAULTS_FILE=$WORKSPACE_ROOT/.devcontainer/.defaults.env
PROFILE_SCRIPT=/etc/profile.d/defaultrc.sh
cat >"$PROFILE_SCRIPT" <<EOF
# Load shared development defaults into login shells.
if [ -r "$DEFAULTS_FILE" ]; then
  set -a
  . "$DEFAULTS_FILE"
  set +a
fi
EOF
chmod 0644 "$PROFILE_SCRIPT"
# zsh does not load /etc/profile.d/ automatically
ZPROFILE=/etc/zsh/zprofile
mkdir -p "$(dirname "$ZPROFILE")"
touch "$ZPROFILE"
if ! grep -qF "$PROFILE_SCRIPT" "$ZPROFILE"; then
  cat >>"$ZPROFILE" <<EOF
# Load shared development defaults (from install.sh).
. "$PROFILE_SCRIPT"
EOF
fi
