#!/bin/bash
set -exuo pipefail

WORKSPACE_PATH=${WORKSPACE_PATH:-/workspaces/astralbeam}

# Host-mounted workspace defaults are useful in development containers but should not leak into reusable cloud images.
DEFAULTS_FILE=$WORKSPACE_PATH/.devcontainer/.defaults.env
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

# zsh does not load /etc/profile.d/ automatically.
ZPROFILE=/etc/zsh/zprofile
mkdir -p "$(dirname "$ZPROFILE")"
touch "$ZPROFILE"
if ! grep -qF "$PROFILE_SCRIPT" "$ZPROFILE"; then
  cat >>"$ZPROFILE" <<EOF
# Load shared development defaults (from profiled.sh).
. "$PROFILE_SCRIPT"
EOF
fi
