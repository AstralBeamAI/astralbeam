#!/bin/bash

set -euo pipefail

worktree_root=$(git rev-parse --show-toplevel)
source_root=${ROOT_WORKTREE_PATH:-}

if [ -z "$source_root" ]; then
  common_git_dir=$(git -C "$worktree_root" rev-parse --path-format=absolute --git-common-dir)
  source_root=$(dirname "$common_git_dir")
fi

source_file="$source_root/webapp/.env.local"
destination_file="$worktree_root/webapp/.env.local"

if [ "$source_file" != "$destination_file" ] && [ -f "$source_file" ] && [ ! -e "$destination_file" ] && [ ! -L "$destination_file" ]; then
  cp -p "$source_file" "$destination_file"
fi

source_database_env_file="$source_root/webapp/.env.development.local"
database_env_file="$worktree_root/webapp/.env.development.local"

if [ -f "$source_database_env_file" ]; then
  cp -p "$source_database_env_file" "$database_env_file"
else
  source_database_env_file="$worktree_root/webapp/.env.development"
fi

database_url=$(sed -n 's/^DATABASE_URL=//p' "$source_database_env_file")
worktree_database=$(basename "${worktree_root%/$(basename "$source_root")}")
printf 'DATABASE_URL=%s/%s\n' "${database_url%/*}" "$worktree_database" >>"$database_env_file"
