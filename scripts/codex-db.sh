#!/bin/bash
set -euo pipefail

[ "$(uname -s)" = Linux ] || exit 0
. /etc/os-release
if [ "${ID:-}" != ubuntu ] || [ "${VERSION_ID:-}" != 24.04 ]; then
  echo "Host database installation supports Ubuntu 24.04 only." >&2
  exit 1
fi
run_as_root() {
  if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo "$@"; fi
}

install_postgres() {
  if [ ! -s /etc/apt/sources.list.d/pgdg.sources ]; then
    run_as_root timeout 45 /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
  fi
  run_as_root env DEBIAN_FRONTEND=noninteractive timeout 90 apt-get \
    -o Acquire::Retries=0 \
    -o Acquire::http::Timeout=30 \
    -o Acquire::https::Timeout=30 \
    -o Dpkg::Use-Pty=0 \
    -o DPkg::Lock::Timeout=60 \
    install -yq --no-install-recommends postgresql-18
}

install_valkey() {
  local architecture checksum
  case "$(dpkg --print-architecture)" in
    arm64) architecture=arm64; checksum=f1477b12c36832dcb8e3e2f83c1a1554a18ab94b204d017e1d8443bff1dade21 ;;
    amd64) architecture=x86_64; checksum=41f5eb5dc88111c5d117821c120c5a9fbcf2bcc3316953f811c04444046ecb28 ;;
    *) echo "Valkey has no official binary for this Ubuntu architecture." >&2; exit 1 ;;
  esac

  local archive="valkey-9.1.1-noble-$architecture.tar.gz" download_dir
  if ! valkey-server --version 2>/dev/null | grep -q "v=9.1.1 "; then
    download_dir=$(mktemp -d)
    trap 'rm -rf "$download_dir"' RETURN
    curl --connect-timeout 10 --max-time 30 -fsSLo "$download_dir/$archive" "https://download.valkey.io/releases/$archive"
    echo "$checksum  $download_dir/$archive" | sha256sum --check -
    tar -xzf "$download_dir/$archive" -C "$download_dir"
    run_as_root install -m 0755 "$download_dir/${archive%.tar.gz}/bin/valkey-server" "$download_dir/${archive%.tar.gz}/bin/valkey-cli" /usr/local/bin/
  fi
}

configure_postgres() {
  run_as_root service postgresql start
  for _ in {1..30}; do pg_isready -q && break; sleep 1; done
  pg_isready -q || { echo "PostgreSQL did not become ready." >&2; exit 1; }
  run_as_root runuser -u postgres -- psql --dbname=postgres --set=ON_ERROR_STOP=1 --set=user="$POSTGRES_USER" --set=password="$POSTGRES_PASSWORD" --set=database="$POSTGRES_DB" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN', :'user') WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'user') \gexec
SELECT format('ALTER ROLE %I PASSWORD %L', :'user', :'password') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'database', :'user') WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'database') \gexec
SELECT format('ALTER DATABASE %I OWNER TO %I', :'database', :'user') \gexec
SQL
}

start_valkey() {
  if ! valkey-cli ping >/dev/null 2>&1; then
    local data_dir=${XDG_DATA_HOME:-$HOME/.local/share}/valkey
    mkdir -p "$data_dir"
    valkey-server --daemonize yes --bind 127.0.0.1 --dir "$data_dir" --logfile "$data_dir/valkey.log"
  fi
}

migrate_webapp_database() {
  (cd "$WORKSPACE_PATH/webapp" && deno task db migrate)
}

: "${POSTGRES_USER:=astralbeam}" "${POSTGRES_PASSWORD:=astralbeam123}" "${POSTGRES_DB:=astralbeam}"
install_postgres
install_valkey
configure_postgres
start_valkey
migrate_webapp_database
