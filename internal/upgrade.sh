#!/usr/bin/env bash

set -euo pipefail

# Parse the whole upgrade before the pull can replace this script.
{
  cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
  platform_binary=/usr/local/bin/astralbeam-platform
  database_url="$(sed -n 's/^[[:space:]]*Environment="DATABASE_URL=\([^"]*\)"[[:space:]]*$/\1/p' /etc/systemd/system/astralbeam-platform.service)"
  database_url="${database_url//%%/%}"
  : "${database_url:?DATABASE_URL is missing from the platform service configuration}"

  git switch main
  git pull --ff-only origin main
  NODE_ENV=development /root/.bun/bin/bun install --frozen-lockfile

  for project in sdk examples/linearity-react website; do
    NODE_ENV=production /root/.bun/bin/bun run --cwd "$project" build
  done

  systemctl restart astralbeam-linearity
  systemctl restart astralbeam-website
  "$platform_binary" upgrade --yes "$@"

  DATABASE_URL="$database_url" NODE_ENV=production "$platform_binary" migrate
  systemctl restart astralbeam-platform
  systemctl status astralbeam-platform --no-pager
  "$platform_binary" version
  curl --fail --silent --show-error \
    --retry 10 --retry-connrefused --retry-delay 1 \
    http://127.0.0.1:3100/api/status
  printf '\n'
  exit
}
