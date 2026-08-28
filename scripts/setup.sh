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
export DENO_INSTALL="${DENO_INSTALL:-$HOME/.deno}"
export PATH="$DENO_INSTALL/bin:$PATH"

# Each application is an independent Deno project with its own package.json, deno.lock, and node_modules.
WORKSPACE_APPS=(webapp www sdk examples/todos)

install_ubuntu_packages() {
  [ "$platform_name" = Linux ] || return 0

  run_as_root env DEBIAN_FRONTEND=noninteractive /bin/bash -euxo pipefail <<'EOF'
if ! command -v gh >/dev/null 2>&1 || ! dpkg-query -W build-essential libatomic1 ca-certificates locales lsb-release tzdata curl wget file unzip git zsh vim nano iputils-ping net-tools procps openssh-client fontconfig pkg-config python3 python3-yaml xdg-utils liburing-dev libsystemd0 libssl3t64 >/dev/null 2>&1; then
apt-get update -yq
apt-get install -y --no-install-recommends \
  build-essential libatomic1 ca-certificates locales lsb-release tzdata \
  curl wget file unzip \
  git \
  zsh \
  vim nano \
  iputils-ping net-tools procps openssh-client \
  fontconfig pkg-config python3 python3-yaml \
  xdg-utils \
  liburing-dev libsystemd0 libssl3t64

# Install GitHub CLI from its supported signed Debian repository: https://github.com/cli/cli/blob/trunk/docs/install_linux.md#debian
mkdir -p -m 755 /etc/apt/keyrings /etc/apt/sources.list.d; curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | tee /etc/apt/keyrings/githubcli-archive-keyring.gpg >/dev/null; chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg; printf 'deb [arch=%s signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main\n' "$(dpkg --print-architecture)" | tee /etc/apt/sources.list.d/github-cli.list >/dev/null
apt-get update -yq; apt-get install -y --no-install-recommends gh
fi

# Host-mounted workspaces often have a different UID than the container user.
if ! git config --system --get-all safe.directory | grep -qxF '*'; then
  git config --system --add safe.directory '*'
fi
EOF
}

install_deno() {
  local deno_stable_version installed_deno_version
  # Resolve the rolling stable channel, then install outside package-manager-owned paths. https://docs.deno.com/runtime/fundamentals/stability_and_releases/
  deno_stable_version=$(curl -fsSL https://dl.deno.land/release-latest.txt)
  installed_deno_version=$(deno eval 'console.log(`v${Deno.version.deno}`)' 2>/dev/null || true)
  if [ "$installed_deno_version" != "$deno_stable_version" ]; then
    curl -fsSL https://deno.land/install.sh | sh -s -- "$deno_stable_version" -y
  fi
  deno --version
}

install_workspace_packages() {
  local app
  for app in "${WORKSPACE_APPS[@]}"; do
    if [ -f "$WORKSPACE_PATH/$app/package.json" ]; then
      # Keep sharp on its lockfile-pinned binary instead of compiling against a host-installed libvips: https://sharp.pixelplumbing.com/install#custom-libvips
      cd "$WORKSPACE_PATH/$app"
      SHARP_IGNORE_GLOBAL_LIBVIPS=1 deno install --frozen --quiet
    fi
  done
}

configure_workspace_git() {
  [ -e "$WORKSPACE_PATH/.git" ] || return 0
  git -C "$WORKSPACE_PATH" remote get-url origin >/dev/null 2>&1 || git -C "$WORKSPACE_PATH" remote add origin https://github.com/AstralBeamAI/astralbeam
  git -C "$WORKSPACE_PATH" config push.default current
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

docker_compose_available() {
  docker compose version >/dev/null 2>&1 && docker info >/dev/null 2>&1
}

databases_are_external() {
  case "${POSTGRES_HOST:-}" in
    "" | 127.0.0.1 | localhost | ::1) return 1 ;;
  esac
  case "${VALKEY_HOST:-}" in
    "" | 127.0.0.1 | localhost | ::1) return 1 ;;
  esac
  return 0
}

start_databases() {
  [ -f "$WORKSPACE_PATH/docker-compose.yml" ] || return 0
  if databases_are_external; then return; fi
  if [ "${SKIP_DOCKER_COMPOSE:-false}" = true ]; then return; fi
  if docker_compose_available; then
    (cd "$WORKSPACE_PATH" && docker compose up --detach --wait)
  fi
}

install_ubuntu_packages
configure_workspace_git
install_deno
install_workspace_packages
run_install_extras
start_databases
if [ -d "$WORKSPACE_PATH/webapp" ]; then
  (cd "$WORKSPACE_PATH/webapp" && deno task db migrate)
fi
