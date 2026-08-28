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
