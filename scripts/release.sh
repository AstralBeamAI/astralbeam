#!/bin/bash

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

fail() {
  echo "error: $1" >&2
  exit 1
}

package_version() {
  sed -n 's/^  "version": "\(.*\)",$/\1/p' "$1/package.json"
}

[ "$(git branch --show-current)" = "main" ] || fail "run this from the main branch"
[ -z "$(git status --porcelain)" ] || fail "commit or discard local changes first"

git fetch --quiet --tags origin main
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || fail "main differs from origin/main, pull or push first"

version=$(package_version sdk)
[ -n "$version" ] || fail "could not read the version from sdk/package.json"
for project in cli platform; do
  [ "$(package_version "$project")" = "$version" ] || fail "$project/package.json must match sdk/package.json version $version"
done

tag="v$version"
! git rev-parse --quiet --verify "refs/tags/$tag" >/dev/null || fail "$tag already exists, bump the versions first"

previous_tag=$(git describe --tags --abbrev=0 --match 'v*')
echo "Commits since $previous_tag:"
git log --oneline "$previous_tag..HEAD"
echo

read -r -p "Tag $(git rev-parse --short HEAD) as $tag and push it to release? [y/N] " answer
[ "$answer" = "y" ] || [ "$answer" = "Y" ] || fail "cancelled"

git tag "$tag"
git push origin "$tag"
echo "Pushed $tag. Monitor the release workflow at https://github.com/AstralBeamAI/astralbeam/actions"
echo "Once it succeeds, approve to publish staged npm packages at https://www.npmjs.com/settings/~/staged-packages"
