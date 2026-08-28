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
  if [ ! -x /usr/lib/postgresql/18/bin/postgres ]; then
    run_as_root env DEBIAN_FRONTEND=noninteractive /bin/bash -euxo pipefail <<'EOF'
install -d /usr/share/keyrings
curl --connect-timeout 10 --max-time 30 -fsSLo /usr/share/keyrings/postgresql.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc
printf 'deb [signed-by=/usr/share/keyrings/postgresql.asc] https://apt.postgresql.org/pub/repos/apt noble-pgdg main\n' >/etc/apt/sources.list.d/pgdg.list
timeout 60 apt-get -o Acquire::Retries=0 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30 update -yq
download_dir=$(mktemp -d)
trap 'rm -rf "$download_dir"' EXIT
(
  cd "$download_dir"
  timeout 60 apt-get -o Acquire::Retries=0 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30 download postgresql-18 postgresql-client-18 libpq5 liburing2
  for archive in ./*.deb; do dpkg-deb --extract "$archive" /; done
)
ldconfig
for command in pg_isready psql; do ln -sf "/usr/lib/postgresql/18/bin/$command" "/usr/local/bin/$command"; done
EOF
  fi
  if ! /usr/lib/postgresql/18/bin/postgres --version 2>/dev/null | grep -q '^postgres (PostgreSQL) 18\.'; then
    echo "PostgreSQL 18 binaries could not be installed." >&2
    exit 1
  fi
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
  local data_dir=/var/lib/postgresql/18/main log_file=/var/log/postgresql-18.log
  if ! id postgres >/dev/null 2>&1; then
    run_as_root useradd --system --home-dir /var/lib/postgresql --shell /usr/sbin/nologin postgres
  fi
  if [ ! -s "$data_dir/PG_VERSION" ]; then
    run_as_root install -d -o postgres -g postgres "$data_dir"
    run_as_root timeout 60 runuser -u postgres -- /usr/lib/postgresql/18/bin/initdb \
      --pgdata="$data_dir" --auth-local=peer --auth-host=scram-sha-256 --no-instructions --no-sync
  fi
  if ! pg_isready -q; then
    run_as_root install -d -o postgres -g postgres /var/run/postgresql
    run_as_root touch "$log_file"
    run_as_root chown postgres:postgres "$log_file"
    if ! run_as_root runuser -u postgres -- /usr/lib/postgresql/18/bin/pg_ctl \
      --pgdata="$data_dir" --log="$log_file" --options='-h 127.0.0.1 -p 5432' --wait start; then
      run_as_root cat "$log_file" >&2
      exit 1
    fi
  fi
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
  [ "$(valkey-cli ping)" = PONG ] || { echo "Valkey did not become ready." >&2; exit 1; }
}

migrate_webapp_database() {
  (cd "$WORKSPACE_PATH/webapp" && timeout 60 deno task db migrate)
}

: "${POSTGRES_USER:=astralbeam}" "${POSTGRES_PASSWORD:=astralbeam123}" "${POSTGRES_DB:=astralbeam}"
install_postgres
install_valkey
configure_postgres
start_valkey
migrate_webapp_database
