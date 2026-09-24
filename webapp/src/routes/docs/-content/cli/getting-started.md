# Getting started

The `astralbeam` CLI manages an organization from the terminal. Let's install it, sign it in with an organization API key, and create our first Tenant and TenantUser. It calls the same [management API](/docs/api) your servers do, so everything here also works from scripts, CI, and coding agents.

## 1. Install the CLI

Run it through npm on Node 22.12 or later, which needs no install step:

```sh
npx @astralbeam/cli --version
```

To type `astralbeam` directly, install it globally:

```sh
npm install --global @astralbeam/cli
```

Without Node, download a standalone binary from the [GitHub releases](https://github.com/AstralBeamAI/astralbeam/releases). Each release attaches `astralbeam-v<version>-<platform>` for `linux-x86_64`, `linux-arm64`, `macos-x86_64`, `macos-arm64`, and `windows-x86_64.exe`. Run these commands to install the Apple silicon build:

```sh
gh release download v0.12.1 --repo AstralBeamAI/astralbeam --pattern 'astralbeam-v0.12.1-macos-arm64'
chmod +x astralbeam-v0.12.1-macos-arm64
mv astralbeam-v0.12.1-macos-arm64 /usr/local/bin/astralbeam
```

**NOTE**: The binaries are not signed. On macOS, a binary downloaded through a browser needs `xattr -d com.apple.quarantine <file>` before its first run.

## 2. Sign in

As an owner or developer, open **API keys** in the dashboard and create a key. See [API keys](/docs/dashboard/api-keys). Logins belong to directories, so first move to the directory where you work on this organization, such as its application's repository. Then run this command and paste the full `key_…_abo_…` value when it asks:

```sh
cd ~/work/acme
astralbeam auth login
```

The prompt hides what you paste. Because `login` reads the organization's name and slug from the API before saving anything, a mistyped key or a wrong server fails here rather than on your next command. It then binds the key to this directory and everything below it, in `~/.config/astralbeam/config.json` or `%APPDATA%\astralbeam\config.json` on Windows, readable only by you. Nothing is written into the directory itself.

For a self-hosted deployment, pass its `/api` base. It must use `https://`, except for `localhost`:

```sh
astralbeam auth login --api-url https://beam.example.com/api
```

Every command now uses the nearest bound directory at or above the one it runs in, and names that organization on stderr before its output:

```text
▸ Acme (acme) · org 01990a5d-… · bound at ~/work/acme
```

To manage a second organization, log in again from its own directory. A directory with no bound ancestor fails with exit code 1 rather than falling back to some other organization.

**TIP**: In CI, skip `login` and set `ASTRALBEAM_API_KEY`, plus `ASTRALBEAM_API_URL` when self-hosting. The key overrides any directory binding, and nothing is written to disk.

Check the organization commands here will use:

```sh
astralbeam auth status
```

It prints the organization, API URL, bound directory, and a masked key, and exits with code 1 if the API rejects the key. `astralbeam auth list` shows every bound directory.

## 3. Create a Tenant and a user

A Tenant is one of your customers, identified by your own stable external ID. Let's create one:

```sh
astralbeam tenants create --external-id customer-42 --name "Acme Logistics" --metadata '{"plan":"pro"}'
```

The output shows the new record, including its internal `id`. Copy that value, because TenantUser commands take it as their first argument:

```sh
astralbeam tenant-users create <tenant-id> --external-id user-7 --name "Alex Morgan"
```

Creating the same external ID again fails with HTTP 409. Look records up by external ID instead:

```sh
astralbeam tenants list --external-id customer-42
```

## 4. Chat as that user

Now let's talk to the organization's default agent as Alex, the way the embedded widget would:

```sh
astralbeam chat --tenant customer-42 --user user-7 "What can you help me with?"
```

The CLI signs a short-lived chat token with your key and streams the reply. Leave out the message to chat interactively, or pipe one in on stdin. See [Commands](./commands.md) for every command, and [Coding agents](./coding-agents.md) to hand the CLI to Claude Code.
