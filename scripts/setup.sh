#!/bin/bash

# Keep this setup script idempotent

set -euo pipefail

SETUP_SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)

case "$*" in
  "" | --worktree) ;;
  *) echo "Usage: $0 [--worktree]" >&2; exit 1 ;;
esac

run_as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  else
    sudo "$@"
  fi
}

WORKSPACE_PATH=${WORKSPACE_PATH:-$(git -C "$SETUP_SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || echo /workspaces/astralbeam)}
export WORKSPACE_PATH
export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"

install_linux_packages() {
  . /etc/os-release
  case "${ID:-}:${VERSION_ID:-}" in
    ubuntu:24.04 | debian:13) ;;
    *) echo "System package installation supports Ubuntu 24.04 and Debian 13 only." >&2; exit 1 ;;
  esac

  export DEBIAN_FRONTEND=noninteractive

  local packages=(
    build-essential libatomic1 ca-certificates locales lsb-release tzdata
    curl wget file unzip git gh zsh vim nano
    iputils-ping net-tools procps openssh-client postgresql-client
    fontconfig pkg-config python3 python3-yaml xdg-utils
    liburing-dev libsystemd0 libssl3t64
  )
  if ! dpkg-query -W -f='${db:Status-Status}\n' "${packages[@]}" 2>/dev/null | awk '$1 != "installed" { exit 1 }'; then
    run_as_root apt-get update -yq
    run_as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${packages[@]}"
  fi
}

install_bun() {
  local bun_version installer installed_version
  if [ -f "$WORKSPACE_PATH/.bun-version" ]; then
    bun_version=$(cat "$WORKSPACE_PATH/.bun-version")
  else
    bun_version=$(cat "$SETUP_SCRIPT_DIR/.bun-version")
  fi
  if command -v bun >/dev/null 2>&1; then installed_version=$(bun --version); fi
  if [ "${installed_version:-}" != "$bun_version" ]; then
    installer=$(mktemp)
    curl -fsSL https://bun.sh/install -o "$installer"
    bash "$installer" "bun-v$bun_version"
    rm -f "$installer"
  fi
  bun --version
}

run_install_extras() {
  [ "$(uname -s)" = Linux ] || return 0
  local install_extra
  local install_extras=()
  read -r -a install_extras <<<"${INSTALL_EXTRA:-}"
  for install_extra in "${install_extras[@]}"; do
    case "$install_extra" in
      linux-tools) (install_linux_packages) ;;
      *) /bin/bash "$SETUP_SCRIPT_DIR/$install_extra.sh" ;;
    esac
  done
}

install_postgres() {
  if dpkg-query -W -f='${db:Status-Status}' postgresql-18 2>/dev/null | grep -qx installed; then return 0; fi
  run_as_root apt-get update -yq
  run_as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends postgresql-common
  grep -Rqs apt.postgresql.org /etc/apt/sources.list.d || run_as_root /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
  run_as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends postgresql-18
}

install_valkey() {
  command -v valkey-server >/dev/null 2>&1 && return 0
  local repository="https://download.valkey.io/packaging/valkey-9.1/deb/$ID${VERSION_ID//./}"
  curl -fsSL https://download.valkey.io/packaging/GPG-KEY-valkey.asc | run_as_root tee /usr/share/keyrings/valkey.asc >/dev/null
  printf 'deb [signed-by=/usr/share/keyrings/valkey.asc] %s %s/\n' "$repository" "$(dpkg --print-architecture)" | run_as_root tee /etc/apt/sources.list.d/valkey.list >/dev/null
  run_as_root apt-get update -yq
  run_as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends valkey-server
}

configure_postgres() {
  if ! run_as_root service postgresql status >/dev/null 2>&1; then run_as_root service postgresql start; fi
  run_as_root runuser -u postgres -- psql --dbname=postgres --set=ON_ERROR_STOP=1 --set=user="$POSTGRES_USER" --set=password="$POSTGRES_PASSWORD" --set=database="$POSTGRES_DB" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN CREATEDB PASSWORD %L', :'user', :'password') WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'user') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'database', :'user') WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'database') \gexec
SQL
  PGPASSWORD="$POSTGRES_PASSWORD" psql --host=127.0.0.1 --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --set=ON_ERROR_STOP=1 --command='SELECT 1' >/dev/null
}

start_valkey() {
  if start-stop-daemon --status --exec "$(command -v valkey-server)" >/dev/null 2>&1; then
    valkey-cli -e ping
    return
  fi
  local data_dir=${XDG_DATA_HOME:-$HOME/.local/share}/valkey
  mkdir -p "$data_dir"
  valkey-server --daemonize yes --bind 127.0.0.1 --dir "$data_dir" --logfile "$data_dir/valkey.log"
  for _ in {1..30}; do
    if valkey-cli -e ping >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  valkey-cli -e ping
}

setup_native_services() (
  install_linux_packages

  : "${POSTGRES_USER:=astralbeam}" "${POSTGRES_PASSWORD:=astralbeam123}" "${POSTGRES_DB:=astralbeam}"
  install_postgres
  install_valkey
  configure_postgres
  start_valkey
)

setup_services() {
  case "${SERVICES:-}" in
    native)
      if [ "$(uname -s)" = Linux ]; then setup_native_services; fi
      ;;
    docker)
      (cd "$WORKSPACE_PATH" && docker compose up --detach --wait --no-recreate)
      ;;
    "") ;;
    *) echo "Invalid SERVICES: $SERVICES. Choose docker or native, or leave it unset." >&2; return 1 ;;
  esac
}

setup_workspace() (
  [ -f "$WORKSPACE_PATH/package.json" ] || return 0
  cd "$WORKSPACE_PATH"
  bun install --frozen-lockfile
  cd platform
  bun run scripts/bootstrap-worktree.ts "$@"
)

run_install_extras
setup_services
install_bun
setup_workspace "$@"
