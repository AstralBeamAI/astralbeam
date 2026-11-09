#!/bin/sh
# Install the standalone Platform server. No Bun or Node installation is required.
# Usage: curl -fsSL https://astralbeam.ai/install.sh | sh
set -eu

fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage: curl -fsSL https://astralbeam.ai/install.sh | sh -s -- [options]

  --version VERSION   Release to install, e.g. 0.29.5 or v0.29.5 (default: latest)
  --install-dir DIR   Absolute binary directory (default: $HOME/.local/bin)
  -h, --help          Show this help
EOF
}

main() {
  version=latest
  install_dir="$HOME/.local/bin"
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --version) version="${2:?--version requires a value}"; shift ;;
      --install-dir) install_dir="${2:?--install-dir requires a value}"; shift ;;
      -h|--help) usage; return ;;
      *) fail "Unknown option: $1. See --help." ;;
    esac
    shift
  done
  case "$install_dir" in
    /*) ;;
    *) fail '--install-dir must be an absolute path.' ;;
  esac

  case "$(uname -s)" in
    Darwin) os=macos ;;
    Linux) os=linux ;;
    *) fail 'This installer supports macOS and Linux. Windows x86_64 binaries: https://github.com/AstralBeamAI/astralbeam/releases/latest' ;;
  esac
  case "$(uname -m)" in
    x86_64|amd64) arch=x86_64 ;;
    arm64|aarch64) arch=arm64 ;;
    *) fail "Unsupported architecture: $(uname -m)" ;;
  esac
  if [ "$os" = macos ] && [ "$arch" = x86_64 ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || true)" = 1 ]; then
    arch=arm64
  fi
  destination="$install_dir/astralbeam-platform"
  if [ -e "$destination" ]; then
    if [ "$version" = latest ]; then
      exec "$destination" upgrade --yes
    fi
    exec "$destination" upgrade --yes "v${version#v}"
  fi

  releases=https://github.com/AstralBeamAI/astralbeam/releases
  if [ "$version" = latest ]; then
    base_url="$releases/latest/download"
  else
    base_url="$releases/download/v${version#v}"
  fi
  asset="astralbeam-platform-$os-$arch"
  printf 'Installing AstralBeam Platform (%s-%s)\n' "$os" "$arch"
  mkdir -p "$install_dir"
  staging=$(mktemp -d "$install_dir/.astralbeam-install.XXXXXX")
  trap 'rm -rf "$staging"' 0
  trap 'exit 1' HUP INT TERM
  curl -fsSL -o "$staging/SHA256SUMS" "$base_url/SHA256SUMS"
  expected=$(awk -v asset="$asset" '$2 == asset { print $1 }' "$staging/SHA256SUMS")
  curl -fsSL -o "$staging/$asset" "$base_url/$asset"
  if [ "$os" = macos ]; then
    actual=$(shasum -a 256 < "$staging/$asset")
  else
    actual=$(sha256sum < "$staging/$asset")
  fi
  [ "${actual%% *}" = "$expected" ] || fail 'Checksum mismatch.'
  chmod 755 "$staging/$asset"
  "$staging/$asset" --version || fail 'The downloaded binary cannot run on this host.'
  mv -f "$staging/$asset" "$destination"
  printf 'Installed %s\n' "$destination"
  case ":$PATH:" in
    *":$install_dir:"*) ;;
    *)
      quoted_dir=$(printf '%s' "$install_dir" | sed "s/'/'\\\\''/g")
      printf '\nAdd %s to PATH in your shell profile. For sh/bash/zsh:\n' "$install_dir"
      printf "  export PATH='%s':\"\$PATH\"\n" "$quoted_dir"
      ;;
  esac
  active_binary=$(command -v astralbeam-platform || true)
  if [ -n "$active_binary" ] && [ "$active_binary" != "$destination" ]; then
    printf '\nAnother installation is first on PATH: %s\nUse %s or update PATH.\n' "$active_binary" "$destination"
  fi
  printf '\nNext: https://astralbeam.ai/docs/self-hosting/deploy\nBack up before upgrades. Restart existing services and apply pending migrations at /configure.\n'
}

# Keep installation in one function so an incomplete download cannot execute its body.
main "$@"
