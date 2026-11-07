#!/usr/bin/env bash
set -euo pipefail

rebuild() {
  echo "Build a new sandbox image: $1"
  exit 0
}

if [ "$FORCE_REBUILD" = true ]; then
  rebuild 'explicit refresh requested'
fi

previous="$(gh api "repos/$GITHUB_REPOSITORY/releases/latest" --jq .tag_name)" || rebuild 'no previous published release'
[[ "$previous" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || rebuild 'no stable release version'
descriptor="$(docker buildx imagetools inspect "$IMAGE_NAME:${previous#v}" --format '{{json .Manifest}}')" || rebuild 'previous image is unavailable'
digest="$(jq -er '.digest | select(test("^sha256:[0-9a-f]{64}$"))' <<< "$descriptor")" || rebuild 'missing image digest'
manifest="$(docker buildx imagetools inspect "$IMAGE_NAME@$digest" --raw)" || rebuild 'image index is unavailable'
revision="$(jq -er '.annotations["org.opencontainers.image.revision"] | select(test("^[0-9a-f]{40}$"))' <<< "$manifest")" || rebuild 'missing original source revision'
created="$(jq -er '.annotations["org.opencontainers.image.created"]' <<< "$manifest")" || rebuild 'missing original build date'
created="$(date -d "$created" +%s)" || rebuild 'invalid original build date'
age=$(( $(date +%s) - created ))
# Retagging preserves this original date. Refresh package installs at least every seven days.
if (( age < 0 || age >= 604800 )); then
  rebuild 'original image is older than seven days'
fi

git merge-base --is-ancestor "$revision" HEAD || rebuild 'original revision is outside this release history'
git diff --quiet "$revision" HEAD -- platform/packages/sandbox/image .github/workflows/sandbox-image.yml || rebuild 'sandbox build inputs changed'

# Require an attestation for each native architecture before keeping the original signed index.
jq -e '
  [.manifests[] | select(.platform.os == "linux") | .platform.architecture] | sort == ["amd64", "arm64"]
' <<< "$manifest" > /dev/null || rebuild 'image does not contain both architectures'
attestations="$(jq -er '
  [.manifests[] | select(.platform.os == "linux") | .digest] as $images |
  [.manifests[] | select(.annotations["vnd.docker.reference.type"] == "attestation-manifest") |
    select(.annotations["vnd.docker.reference.digest"] as $image | $images | index($image))] |
  select(length == 2 and (map(.annotations["vnd.docker.reference.digest"]) | unique | length == 2)
    and all(.[]; .digest | test("^sha256:[0-9a-f]{64}$"))) | .[].digest
' <<< "$manifest")" || rebuild 'missing architecture attestations'

{
  echo "digest=$digest"
  echo 'cosign-verify-commands<<VERIFY'
  while read -r attestation; do
    printf "cosign verify --certificate-identity-regexp '^https://github[.]com/docker/github-builder/[.]github/workflows/build[.]yml@' --certificate-oidc-issuer https://token.actions.githubusercontent.com --certificate-github-workflow-repository %q --certificate-github-workflow-sha %q %q\n" \
      "$GITHUB_REPOSITORY" "$revision" "$IMAGE_NAME@$attestation"
  done <<< "$attestations"
  echo VERIFY
} >> "$GITHUB_OUTPUT"
echo "Reuse sandbox image $IMAGE_NAME@$digest from $previous"
