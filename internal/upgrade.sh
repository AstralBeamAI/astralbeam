#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
platform_binary="$(command -v astralbeam-platform)"

bun run --cwd "$repo_root/sdk" build
bun run --cwd "$repo_root/examples/linearity-react" build
bun run --cwd "$repo_root/website" build

sudo systemctl restart astralbeam-linearity
sudo systemctl restart astralbeam-website

sudo "$platform_binary" upgrade --yes "$@"

printf '\n%s\n' \
  'Database migrations have NOT been run.' \
  "Run $platform_binary migrate with the production DATABASE_URL, then:" \
  'sudo systemctl restart astralbeam-platform'
