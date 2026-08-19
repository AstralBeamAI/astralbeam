# Setup

## One-time macOS setup

Choose one of the two local workflows below: use the devcontainer or run the codebase directly on macOS.

### Install Podman

- Install Podman Desktop:

  ```bash
  brew install --cask podman-desktop
  ```

- Start Podman Desktop, create a Podman machine, and enable Docker compatibility.

- Do not install the Compose extension from Podman Desktop. Its provider installs a `docker-compose` wrapper that breaks BuildKit functionality.

- Install `podman-compose`:

  ```bash
  brew install podman-compose
  brew uninstall --ignore-dependencies podman # Podman Desktop already provides the Podman CLI
  ```

### Option 1: Use the devcontainer

- Open the repository root in Cursor or VS Code and choose **Reopen in Container**. The devcontainer finishes setup after PostgreSQL and Valkey are healthy.

#### Optional: Match the devcontainer workspace path

To help agent CLIs find the codebase outside the devcontainer, expose the directory containing the repository at `/workspaces` on macOS. For example, a repository cloned at `$HOME/projects/astralbeam` will then be available at `/workspaces/astralbeam`, with the Webapp at `/workspaces/astralbeam/webapp`.

- On modern macOS, `/` is read-only, so use `/etc/synthetic.conf` to create the root-level symlink.
- Check for an existing entry with `sudo grep -n '^workspaces' /etc/synthetic.conf 2>/dev/null`. If nothing is returned, add one:

  ```bash
  export WORKSPACES_PATH=<> # e.g., $HOME/projects
  printf "workspaces\\t$WORKSPACES_PATH\\n" | sudo tee -a /etc/synthetic.conf # The separator must be a literal tab; `printf` supplies it.
  ```

- Reboot your Mac because synthetic entries are created during early startup and cannot be added at runtime. See `man synthetic.conf` for details.
- After rebooting, verify the path:

  ```bash
  readlink /workspaces
  ls -ld /workspaces/astralbeam/webapp
  ```

### Option 2: Run directly on macOS

- From the repository root, run the setup script. It installs the Deno LTS toolchain and both projects' frozen dependencies:

  ```bash
  ./scripts/setup.sh
  ```

- Open a new terminal so the project-managed Deno LTS is on `PATH` before running `deno task` commands.

- Start PostgreSQL and Valkey and wait for both services to become healthy:

  ```bash
  podman compose up --detach --wait
  ```

- From the repository root, stop services with `podman compose down`. Add `--volumes` to permanently delete the local PostgreSQL and Valkey data.

## Cloud agent setup

See the setup guides for [Codex](.codex/README.md) and [Cursor Cloud Agents](.cursor/README.md).
