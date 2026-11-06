# Getting started

Create a customer account and chat as one of its users from your terminal. The `astralbeam` CLI uses the same [API](/docs/api) as your backend.

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

To use a standalone binary instead, follow the [binary installation instructions](https://github.com/AstralBeamAI/astralbeam/blob/main/cli/README.md#install).

## 2. Sign in

Create an [API key](/docs/dashboard/api-keys) as an organization owner or developer. From your application's repository, run the command below and paste the full `key_…_abo_…` value at the hidden prompt:

```sh
cd ~/work/acme
astralbeam auth login
```

The CLI verifies the key and remembers the organization for this directory and its descendants. Credentials stay in your private user configuration, outside the repository.

For a self-hosted deployment, pass its `/api` base. Use HTTPS, or HTTP on localhost for development:

```sh
astralbeam auth login --api-url https://beam.example.com/api
```

Commands print the active organization before their output. To work with another organization, log in from a separate directory.

**TIP**: In CI, set `ASTRALBEAM_API_KEY` and, for self-hosting, `ASTRALBEAM_API_URL`. Environment values override saved login settings.

Confirm the active organization:

```sh
astralbeam auth status
```

Check that it names the organization you intend to use. See [Commands](./commands.md#auth) for saved logins and credential storage.

## 3. Create a Tenant and a user

A Tenant represents one of your customers. Create one with the stable ID your application uses:

```sh
astralbeam tenants create --external-id customer-42 --name "Acme Logistics"
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

Send a message as Alex. The [default agent](/docs/dashboard/agents#the-default-agent) replies with its assigned model:

```sh
astralbeam chat --tenant customer-42 --user user-7 "What can you help me with?"
```

A reply should stream into the terminal. Omit the message to start interactive chat. See [Commands](./commands.md) for scripting options, or [Coding agents](./coding-agents.md) to use the CLI with your coding assistant.
