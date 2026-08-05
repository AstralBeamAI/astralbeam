# Setup

## One-time macOS setup

Choose one of the two local workflows below: use the devcontainer or run the codebase directly on macOS.

### Install Podman

- Install Podman Desktop:

  ```bash
  brew install --cask podman-desktop
  ```

  - Start Podman Desktop.
  - Create a Podman machine.
  - Enable Docker compatibility.
  - Do not install the Compose extension from Podman Desktop. Its official Compose provider installs a `docker-compose` wrapper that breaks BuildKit functionality.

- Install `podman-compose`:

  ```bash
  brew install podman-compose
  brew uninstall --ignore-dependencies podman # Podman Desktop already provides the Podman CLI
  ```

### Option 1: Use the devcontainer

- Open the repository in Cursor or VS Code and choose **Reopen in Container**. The devcontainer starts after PostgreSQL and Valkey are healthy.

#### Optional: Match the devcontainer workspace path

To help agent CLIs find the codebase outside the devcontainer, create the same `/workspaces` path on macOS:

- On modern macOS, `/` is read-only, so use `/etc/synthetic.conf` to create the root-level symlink.
- Check for an existing entry with `sudo grep -n '^workspaces' /etc/synthetic.conf 2>/dev/null`. If nothing is returned, add one:

  ```bash
  export PROJECT_PATH=<> # e.g., $HOME/projects/astralbeam
  printf "workspaces\\t$PROJECT_PATH\\n" | sudo tee -a /etc/synthetic.conf # The separator must be a literal tab; `printf` supplies it.
  ```

- Reboot your Mac because synthetic entries are created during early startup and cannot be added at runtime. See `man synthetic.conf` for details.
- After rebooting, verify the path:

  ```bash
  readlink /workspaces
  ls -ld /workspaces/astralbeam
  ```

### Option 2: Run directly on macOS

- From the repository root, run the shared setup script, then start a new login shell:

  ```bash
  ./scripts/setup.sh
  ```

- Start PostgreSQL and Valkey and wait for both services to become healthy:

  ```bash
  podman compose up --detach --wait
  ```

- Stop services with `podman compose down`. Add `--volumes` to permanently delete the local PostgreSQL and Valkey data.

## Cloud agent setup

See the setup guides for [Codex](.codex/README.md) and [Cursor Cloud Agents](.cursor/README.md).
