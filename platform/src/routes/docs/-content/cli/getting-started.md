# Getting started

Use the `astralbeam` CLI to manage Tenants and TenantUsers and test agents from the terminal. It calls the same [management API](/docs/api) as your servers and supports scripts, CI, and coding agents.

## 1. Install the CLI

Install globally with Node 22.12 or later, or with Bun:

<!-- ::start:tabs variant="files" -->

```sh title="npm"
npm install --global @astralbeam/cli
```

```sh title="pnpm"
pnpm add --global @astralbeam/cli
```

```sh title="bun"
bun add --global @astralbeam/cli
```

<!-- ::end:tabs -->

To run without installing, replace `astralbeam` below with `npx @astralbeam/cli` or `bunx @astralbeam/cli`.

Without a package manager, download the matching `astralbeam-<platform>` binary from [GitHub releases](https://github.com/AstralBeamAI/astralbeam/releases) and add it to your `PATH`. Builds cover Linux and macOS on x86_64/ARM64, plus Windows x86_64.

**NOTE**: Binaries are unsigned. On macOS, browser downloads may require `xattr -d com.apple.quarantine <file>` before running.

## 2. Sign in

As an owner or developer, open **API keys** in the dashboard and create a key. See [API keys](/docs/dashboard/api-keys). Logins are directory-scoped. Open your application's repository, run the command below, and paste the full `key_…_abo_…` value at the hidden prompt:

```sh
cd ~/work/acme
astralbeam auth login
```

The CLI verifies the key before saving a binding for this directory and its descendants. It stores credentials in your private `~/.config/astralbeam/config.json`, or `%APPDATA%\astralbeam\config.json` on Windows. Nothing is written into the repository.

For a self-hosted deployment, pass its `/api` base. Use HTTPS, or HTTP on localhost for development:

```sh
astralbeam auth login --api-url https://beam.example.com/api
```

Commands use the nearest bound directory and print the organization before their output. For another organization, log in from a separate directory. Unbound directories fail instead of selecting another organization.

**TIP**: In CI, skip `login` and set `ASTRALBEAM_API_KEY`, plus `ASTRALBEAM_API_URL` when self-hosting. The key overrides any directory binding, and nothing is written to disk. The URL also overrides a bound key's saved URL.

Confirm the active organization:

```sh
astralbeam auth status
```

`auth status` verifies the key and shows the active organization. See [Commands](./commands.md#auth) for binding management and credential storage.

## 3. Create a Tenant and a user

A Tenant is one of your customers, identified by your own stable external ID. Let's create one:

```sh
astralbeam tenants create --external-id customer-42 --name "Acme Logistics" --metadata '{"plan":"pro"}'
```

The output shows the new record, including its internal `id`. Copy that value, because the TenantUser create command takes it as its first argument:

```sh
astralbeam tenant-users create <tenant-id> --external-id user-7 --name "Alex Morgan"
```

Creating the same external ID again fails with HTTP 409. Look records up by external ID instead:

```sh
astralbeam tenants list --external-id customer-42
```

## 4. Chat as that user

With a model assigned to the [default agent](/docs/dashboard/agents#the-default-agent), let's send a message as Alex:

```sh
astralbeam chat --tenant customer-42 --user user-7 "What can you help me with?"
```

A reply should stream into the terminal. The CLI signs a short-lived token with your key. Omit the message for interactive chat, or pipe one in on stdin. See [Commands](./commands.md) for every command, and [Coding agents](./coding-agents.md) to hand the CLI to Claude Code.
