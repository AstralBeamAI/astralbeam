#!/bin/bash

# Keep this setup script idempotent

set -exuo pipefail

SETUP_SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
platform_name=$(uname -s)

case "$platform_name" in
  Darwin | Linux) ;;
  *)
    echo "Unsupported operating system: $platform_name" >&2
    exit 1
    ;;
esac

# GitHub-hosted Ubuntu runners use sudo for system packages; container builds already run as root. https://docs.github.com/en/actions/how-tos/manage-runners/github-hosted-runners/customize-runners#installing-software-on-ubuntu-runners
run_as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  else
    sudo "$@"
  fi
}

if [ -z "${WORKSPACE_PATH:-}" ]; then
  WORKSPACE_PATH=$(git rev-parse --show-toplevel 2>/dev/null || true)
  WORKSPACE_PATH=${WORKSPACE_PATH:-/workspaces/astralbeam}
fi
export WORKSPACE_PATH
export VP_HOME="${VP_HOME:-$HOME/.vite-plus}"
export PATH="$VP_HOME/bin:$PATH"

NODE_VERSION_FILE="$WORKSPACE_PATH/.node-version"
if [ ! -r "$NODE_VERSION_FILE" ]; then
  NODE_VERSION_FILE=/tmp/.node-version
fi
if [ ! -r "$NODE_VERSION_FILE" ]; then
  echo "Could not find .node-version in $WORKSPACE_PATH or /tmp." >&2
  exit 1
fi

install_macos_packages() {
  [ "$platform_name" = Darwin ] || return 0
  if ! brew list --cask font-montserrat >/dev/null 2>&1; then
    brew install --cask font-montserrat
  fi
}

install_ubuntu_packages() {
  [ "$platform_name" = Linux ] || return 0

  run_as_root env DEBIAN_FRONTEND=noninteractive /bin/bash -euxo pipefail <<'EOF'
apt-get update -yq
apt-get install -y --no-install-recommends \
  build-essential libatomic1 ca-certificates locales lsb-release tzdata \
  curl wget \
  git \
  zsh \
  vim nano \
  iputils-ping net-tools procps openssh-client \
  fontconfig fonts-montserrat pkg-config python3 python3-yaml \
  xdg-utils \
  liburing-dev

# Install GitHub CLI from its supported signed Debian repository: https://github.com/cli/cli/blob/trunk/docs/install_linux.md#debian
mkdir -p -m 755 /etc/apt/keyrings /etc/apt/sources.list.d; curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | tee /etc/apt/keyrings/githubcli-archive-keyring.gpg >/dev/null; chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg; printf 'deb [arch=%s signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main\n' "$(dpkg --print-architecture)" | tee /etc/apt/sources.list.d/github-cli.list >/dev/null
apt-get update -yq; apt-get install -y --no-install-recommends gh

# Host-mounted workspaces often have a different UID than the container user.
if ! git config --system --get-all safe.directory | grep -qxF '*'; then
  git config --system --add safe.directory '*'
fi
EOF
}

install_vite_plus() {
  # Install the full development/build toolchain; production images need a separate runtime stage: https://viteplus.dev/guide/docker#production-ssr-node-js-server-app
  if ! command -v vp >/dev/null 2>&1; then
    mkdir -p "$VP_HOME"
    curl -fsSL https://vite.plus | bash
    # The installer pre-provisions a default Node.js; use the project pin instead.
    rm -rf "$VP_HOME/js_runtime"
  fi
  vp --version
  vp env setup
  vp env on
  vp env install "$(cat "$NODE_VERSION_FILE")"
  node --version
}

install_workspace_packages() {
  [ -f "$WORKSPACE_PATH/package.json" ] || return 0
   # Keep sharp on its lockfile-pinned binary instead of compiling against a host-installed libvips: https://sharp.pixelplumbing.com/install#custom-libvips
  (cd "$WORKSPACE_PATH" && SHARP_IGNORE_GLOBAL_LIBVIPS=1 vp install --frozen-lockfile)
}

run_install_extras() {
  [ "$platform_name" = Linux ] || return 0
  [ -n "${INSTALL_EXTRA:-}" ] || return 0
  local install_extra install_extra_script
  local install_extras=()
  read -r -a install_extras <<<"$INSTALL_EXTRA"
  for install_extra in "${install_extras[@]}"; do
    if [[ ! "$install_extra" =~ ^[[:alnum:]_-]+$ ]]; then
      echo "Invalid INSTALL_EXTRA script name: $install_extra" >&2
      exit 1
    fi
    install_extra_script="$SETUP_SCRIPT_DIR/$install_extra.sh"
    if [ ! -r "$install_extra_script" ]; then
      echo "Could not find INSTALL_EXTRA script: $install_extra_script" >&2
      exit 1
    fi
    /bin/bash "$install_extra_script"
  done
}

install_macos_packages
install_ubuntu_packages
install_vite_plus
install_workspace_packages
run_install_extras
