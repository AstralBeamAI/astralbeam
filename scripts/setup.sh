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
export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"

install_ubuntu_packages() {
  [ "$platform_name" = Linux ] || return 0

  run_as_root env DEBIAN_FRONTEND=noninteractive /bin/bash -euxo pipefail <<'EOF'
if ! command -v gh >/dev/null 2>&1 || ! dpkg-query -W build-essential libatomic1 ca-certificates locales lsb-release tzdata curl wget file unzip git zsh vim nano iputils-ping net-tools procps openssh-client fontconfig pkg-config python3 python3-yaml xdg-utils liburing-dev postgresql-common libsystemd0 libssl3t64 >/dev/null 2>&1; then
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
  liburing-dev postgresql-common libsystemd0 libssl3t64

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

install_bun() {
  local bun_version installer
  if [ -f "$WORKSPACE_PATH/.bun-version" ]; then
    bun_version=$(cat "$WORKSPACE_PATH/.bun-version")
  else
    bun_version=$(cat "$SETUP_SCRIPT_DIR/.bun-version")
  fi
  if [ "$(bun --version 2>/dev/null || true)" != "$bun_version" ]; then
    installer=$(mktemp)
    curl -fsSL https://bun.sh/install -o "$installer"
    bash "$installer" "bun-v$bun_version"
    rm -f "$installer"
  fi
  bun --version
}

install_workspace_packages() {
  [ -f "$WORKSPACE_PATH/package.json" ] || return 0
  bun install --cwd "$WORKSPACE_PATH" --frozen-lockfile
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

# Starts an installed native RustFS with Compose's ports and credentials, so macOS file storage
# needs no container. https://docs.rustfs.com/en/installation/macos
start_native_storage() {
  command -v rustfs >/dev/null 2>&1 || return 0
  local port="${RUSTFS_HOST_PORT:-9000}" log="$HOME/.local/share/rustfs/rustfs.log"
  # RustFS refuses a data directory holding other files, so its log sits beside it.
  local data_dir="${RUSTFS_DATA_DIR:-$HOME/.local/share/rustfs/data}"
  if endpoint_is_reachable "http://127.0.0.1:$port"; then return 0; fi
  mkdir -p "$data_dir" "${log%/*}"
  # Like Compose, the console is enabled through the environment. The `--console-enable` flag
  # takes no value, so a following argument would be read as the data directory.
  RUSTFS_ACCESS_KEY="${RUSTFS_ACCESS_KEY:-development}" \
    RUSTFS_SECRET_KEY="${RUSTFS_SECRET_KEY:-development-only-storage-key}" \
    RUSTFS_CONSOLE_ENABLE=true RUSTFS_CONSOLE_ADDRESS="127.0.0.1:${RUSTFS_CONSOLE_HOST_PORT:-9001}" \
    nohup rustfs server --address "127.0.0.1:$port" "$data_dir" >"$log" 2>&1 &
  for _ in $(seq 30); do
    if endpoint_is_reachable "http://127.0.0.1:$port"; then return 0; fi
    sleep 1
  done
  echo "RustFS did not start. See $log." >&2
  return 1
}

start_databases() {
  [ -f "$WORKSPACE_PATH/docker-compose.yml" ] || return 0
  # macOS development runs the native checkout against a database the developer already runs, so
  # this script never starts Compose there. See AGENTS.md's macOS rule.
  if [ "$platform_name" = Darwin ]; then
    start_native_storage
    echo "Skipped Docker Compose: start the macOS infrastructure as described in SETUP.md." >&2
    return 0
  fi
  if databases_are_external; then return; fi
  if [ "${SKIP_DOCKER_COMPOSE:-false}" = true ]; then return; fi
  if docker_compose_available; then
    (cd "$WORKSPACE_PATH" && docker compose up --detach --wait)
  fi
}

# Vite loads `platform/.env.development[.local]`, and a shell value always wins, so this reads the
# same order the platform does. https://vite.dev/guide/env-and-mode
platform_database_url() {
  local env_file url
  if [ -n "${DATABASE_URL:-}" ]; then
    printf '%s\n' "$DATABASE_URL"
    return 0
  fi
  for env_file in "$WORKSPACE_PATH/platform/.env.development.local" "$WORKSPACE_PATH/platform/.env.development"; do
    [ -f "$env_file" ] || continue
    url=$(sed -n 's/^DATABASE_URL=//p' "$env_file" | tail -n 1)
    if [ -n "$url" ]; then
      printf '%s\n' "$url"
      return 0
    fi
  done
  return 1
}

# Probe connectivity without platform-specific nc flags. https://bun.sh/docs/api/tcp
endpoint_is_reachable() {
  ENDPOINT_PROBE_URL="$1" bun --no-env-file -e \
    'const { hostname, port } = new URL(process.env.ENDPOINT_PROBE_URL); const socket = await Bun.connect({ hostname, port: Number(port) || 5432, socket: { data() {} } }); socket.end()' \
    >/dev/null 2>&1
}

# The schema and the sample data before the SDK bundle, because the seed writes the API key and
# agent ID that `examples/todos` reads and the example loads the SDK's built `dist`.
bootstrap_workspace() {
  [ -d "$WORKSPACE_PATH/platform" ] || return 0
  local url
  # `DATABASE_URL` can carry a real password and this script runs under `set -x`, so the value is
  # resolved and probed with tracing off, and only its credential-free tail is ever printed.
  set +x
  if ! url=$(platform_database_url); then
    echo "Skipped the migrate, seed, and SDK build steps: no DATABASE_URL in the environment or in platform/.env.development[.local]." >&2
    set -x
    return 0
  fi
  # Checked on every platform: a caller can reach here before its database is up — Cursor Cloud
  # installs before it starts Compose — and a named skip is more use than a `set -e` failure.
  if ! endpoint_is_reachable "$url"; then
    echo "Skipped the migrate, seed, and SDK build steps: nothing is listening at ${url##*@}. Start PostgreSQL, then rerun './scripts/setup.sh' to migrate, seed, and build the SDK." >&2
    set -x
    return 0
  fi
  set -x
  (cd "$WORKSPACE_PATH/platform" && bun run db migrate)
  (cd "$WORKSPACE_PATH/platform" && bun run db-seed)
  (cd "$WORKSPACE_PATH/sdk" && bun run build)
}

install_ubuntu_packages
configure_workspace_git
install_bun
install_workspace_packages
run_install_extras
start_databases
bootstrap_workspace
