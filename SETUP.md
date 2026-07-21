# Setup

## One-time

### Devcontainer (on MacOS)

- Install Podman

  - Podman Desktop

    ```bash
    brew install --cask podman-desktop
    ```

    - Start the Podman Desktop
    - Create a podman machine
    - Enable docker compatibility
    - Do NOT install compose extension from Podman Desktop. Official compose wrapper from Podman Desktop installs docker-compose wrapper breaking BUILDKIT functionality.

  - podman-compose

    ```bash
    brew install podman-compose
    brew uninstall --ignore-dependencies podman # Don't need it as podman desktop would have installed podman
    ```

- (Optional) To make Agent CLIs auto-detect codebase even outside devcontainers, configure symlink with same directory structure as that of devcontainer
  - On modern macOS, `/` is read-only, so use `/etc/synthetic.conf` to create the root-level symlink.
  - First check for an existing entry: `sudo grep -n '^workspaces' /etc/synthetic.conf 2>/dev/null`. If nothing is returned, add this entry:

    ```bash
    export PROJECT_PATH=<> # e.g., $HOME/projects/astralbeam
    printf "workspaces\\t$PROJECT_PATH\\n" | sudo tee -a /etc/synthetic.conf # The separator must be a literal tab; `printf` supplies it.
    ```

  - Then reboot your Mac. Synthetic entries are created during early boot and cannot be added at runtime. macOS synthetic.conf manual.
  - After reboot, verify:

    ```bash
    readlink /workspaces
    ls -ld /workspaces/astralbeam
    ```

### MacOS directly

- TODO
