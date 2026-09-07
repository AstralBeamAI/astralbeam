# AstralBeam

**Links:** [Website](https://astralbeam.ai) · [Docs](https://app.astralbeam.ai/docs) · [Hosted app](https://app.astralbeam.ai) · [Discord](https://discord.gg/S7j384JvSa)

Adding agents to a web app today involves patching together a bunch of frontend libraries, backend frameworks, LLM providers, observability tools, billing APIs, etc. which is time-taking and error-prone.

[AstralBeam](https://astralbeam.ai) aims to provide a single service developers can integrate to add production-ready agents to any web app:
- you drop-in our frontend SDK to get a fully-customizable Cursor-like agent sidebar UI
- you get fully-managed infra for chat streaming, conversation history, and observability
- you can hook up tools & skills, let users add MCPs, and let agents take actions in the app
- you can set up per-customer rate limits & token-based billing integrated with Stripe
- non-technical users (PMs etc.) can manage & A/B test prompts & run evals in production
- and more: multiplayer chat, background agents, dynamic LLM routing, prompt caching
- includes multi-tenancy, enterprise-grade SSO, data privacy & role-based access control

The entire platform is open-source, so you can self-host it or use our cloud offering. It’s modular & compatible with open standards like MCP and AG-UI, so you can adopt it incrementally if you have an existing stack in place.

Our north star is to enable developers to ship agents in minutes, instead of weeks/months, and get started with just a few lines of code.

## Codebase Structure

There are four independent Deno projects: a TanStack Start product application with app-local shadcn/ui components, the public Astro website, the frontend SDK published to npm, and a standalone TanStack Start example that consumes the built SDK.

```text
webapp/       # TanStack Start application, database, theme, and UI
www/          # Public website
sdk/          # Frontend SDK, published to npm as @astralbeam/sdk
examples/     # Standalone SDK consumer applications
```


## Local development

Local development spans three apps: the webapp serves the `/api/chat` agent endpoint, the SDK builds the chat widget, and the todos example embeds it. From a fresh clone, a running database plus `./scripts/setup.sh` and `deno task dev` is the whole loop.

### 1. Start PostgreSQL and Mailpit

With Docker Compose, `docker compose up --detach --wait` from the repository root starts PostgreSQL, PgBouncer, Valkey, and Mailpit, and the default `DATABASE_URL` already points at PgBouncer, the only database endpoint published to the host.

Natively on macOS, run your own PostgreSQL 18 or later reachable at the `DATABASE_URL` in [`webapp/.env.development`](webapp/.env.development), and Mailpit on ports 1025 and 8025 only if you want to read the outgoing email. See [`SETUP.md`](SETUP.md) for the one-time prerequisites.

### 2. Set up the workspace

```sh
./scripts/setup.sh
```

This installs Deno and every project's frozen dependencies, then — once it can reach the database — applies the migrations, runs `deno task --cwd webapp db-seed`, and builds the SDK into `sdk/dist`. If nothing is listening yet it says so and skips those three steps; start PostgreSQL and run it again.

The seed creates verified accounts, organizations, agents, and organization API keys, so local testing skips `/configure`, signup, and email verification; see the [database guide](webapp/src/db/README.md#seed-sample-data). It also writes `examples/todos/.env` with the seeded API key and agent ID when that file does not exist, so the example's token route can mint chat tokens.

`DATABASE_URL` and `DATABASE_ENCRYPTION_KEY` are the only bootstrap variables, and [`webapp/.env.development`](webapp/.env.development) supplies local defaults for both. Every other runtime setting lives at <http://localhost:4500/configure>, which the first `DATABASE_ENCRYPTION_KEY` value signs into; deployment guidance is in [Setup](SETUP.md#configure-the-environment).

### 3. Add an OpenAI key

The seed never writes one, so chat needs a key of your own in `webapp/.env.local`:

```sh
OPENAI_API_KEY=sk-...
```

### 4. Run everything

```sh
deno task dev
```

This starts the three dev servers and the SDK watcher together:

- <http://localhost:4500> — the product application and its `/api/chat` agent endpoint
- <http://localhost:4600> — the public website
- <http://localhost:4700> — the todos example with the embedded widget; see [`examples/todos/README.md`](examples/todos/README.md) for what to try

Reload the page after changing SDK sources: the watcher rewrites the `sdk/dist` output the example imports.

### 5. Run the projects from the repository root

The four projects keep their own toolchains and are not a package-manager workspace, but the root [`deno.jsonc`](deno.jsonc) forwards the common commands so you do not have to change directories:

```sh
deno task install          # install every project's dependencies
deno task dev              # run the three dev servers and the SDK watcher together
deno task build            # build the SDK first, then the webapp, website, and todos
```

Every task also has a per-project form: `deno task dev:webapp`, `deno task build:sdk`, `deno task install:todos`, and so on. Run `deno task` from the root to list them. Anything else still runs from the owning project, either by changing into it or with `deno task --cwd <project> <task>`.

## Authentication

The product application uses Better Auth for verified email/password accounts and Google or GitHub OAuth, requires legal acceptance before signup, and uses organizations as its SaaS membership boundary. Follow the [authentication and transactional-email setup](SETUP.md#authentication-and-transactional-email) before testing account creation locally.

The Webapp owns authentication configuration, authorization boundaries, account UI, transactional auth email, and the Drizzle auth schema. Route guards control navigation, while Better Auth APIs and server-only functions enforce session and organization authorization.

## Licensing

Portions of this repository are licensed as follows:

- Files under [`www`](www), [`sdk`](sdk), and [`examples`](examples) are licensed under the [MIT License](LICENSE-MIT), except for third-party material governed by its applicable license.
- All other files in this repository are licensed under the [GNU Affero General Public License v3.0 only](LICENSE-AGPL) (`AGPL-3.0-only`), except where an adjacent license or notice states otherwise.
- Third-party components and materials are licensed under the applicable licenses provided by their respective owners. See [third-party notices](docs/legal/THIRD_PARTY_NOTICES.md).

Copyright © 2026 AstralBeam Inc. for AstralBeam-controlled material. Third-party material remains subject to its respective copyright and license terms.
