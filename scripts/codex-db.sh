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
as_postgres() {
  run_as_root runuser -u postgres -- "$@"
}

install_postgres() {
  [ -x /usr/lib/postgresql/18/bin/postgres ] && return
  run_as_root /bin/bash -eu <<'EOF'
curl -fsSLo /usr/share/keyrings/postgresql.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc
printf 'deb [signed-by=/usr/share/keyrings/postgresql.asc] https://apt.postgresql.org/pub/repos/apt noble-pgdg main\n' >/etc/apt/sources.list.d/pgdg.list
apt-get -o Acquire::Retries=0 update -q
download_dir=$(mktemp -d)
trap 'rm -rf "$download_dir"' EXIT
cd "$download_dir"
apt-get -o Acquire::Retries=0 download postgresql-18 postgresql-client-18 libpq5
for archive in ./*.deb; do dpkg-deb --extract "$archive" /; done
ldconfig
EOF
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
    curl -fsSLo "$download_dir/$archive" "https://download.valkey.io/releases/$archive"
    echo "$checksum  $download_dir/$archive" | sha256sum --check -
    tar -xzf "$download_dir/$archive" -C "$download_dir"
    run_as_root install -m 0755 "$download_dir/${archive%.tar.gz}/bin/valkey-server" "$download_dir/${archive%.tar.gz}/bin/valkey-cli" /usr/local/bin/
  fi
}

configure_postgres() {
  local postgres_bin=/usr/lib/postgresql/18/bin data_dir=/var/lib/postgresql/18/main
  id postgres >/dev/null 2>&1 || run_as_root useradd --system --home-dir /var/lib/postgresql --shell /usr/sbin/nologin postgres
  run_as_root install -d -o postgres -g postgres "$data_dir" /var/run/postgresql
  [ -s "$data_dir/PG_VERSION" ] || as_postgres "$postgres_bin/initdb" --pgdata="$data_dir" --auth-local=peer --auth-host=scram-sha-256 --no-instructions
  if ! "$postgres_bin/pg_isready" -q; then
    as_postgres "$postgres_bin/pg_ctl" --pgdata="$data_dir" --log="$data_dir/postgresql.log" --options='-h 127.0.0.1' start || { run_as_root cat "$data_dir/postgresql.log" >&2; exit 1; }
  fi
  as_postgres "$postgres_bin/psql" --dbname=postgres --set=ON_ERROR_STOP=1 --set=user="$POSTGRES_USER" --set=password="$POSTGRES_PASSWORD" --set=database="$POSTGRES_DB" <<'SQL'
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

: "${POSTGRES_USER:=astralbeam}" "${POSTGRES_PASSWORD:=astralbeam123}" "${POSTGRES_DB:=astralbeam}"
install_postgres
install_valkey
configure_postgres
start_valkey
