# AstralBeam

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

Local development & testing is split across three apps: the webapp serves the agent endpoint, the SDK builds the chat widget, and the todos example embeds it.

### 1. Set up the toolchain

Follow [`SETUP.md`](SETUP.md) for prerequisites and the PostgreSQL and Valkey service lifecycle, then install Deno and the projects' frozen dependencies:

```sh
./scripts/setup.sh
```

### 2. Run the webapp

Serve the product application and the `/api/chat` agent endpoint on http://localhost:3000 :

```sh
cd webapp
deno install
deno task dev
```

`DATABASE_URL` and `DATABASE_ENCRYPTION_KEY` are required before http://localhost:3000/configure opens operator sign-in. Use the first encryption key to apply pending migrations and manage other runtime settings; deployment guidance is in [Setup](SETUP.md#configure-the-environment).

### 3. Build the SDK

The SDK bundles the client, server, React, and Vue entry points into `sdk/dist`, the artifacts consumers import:

```sh
cd sdk
deno install
deno task build
```

### 4. Run the todos example

A barebones TanStack Start app that embeds the widget from `sdk/dist`, mints demo chat tokens on the server, and points the widget at the webapp's `/api/chat`, on http://localhost:3100. See [`examples/todos/README.md`](examples/todos/README.md) for what to try.

```sh
cd examples/todos
deno install
deno task dev
```

Rebuild the SDK and reload the page after changing SDK sources. The public website is separate: `cd www && deno task dev` starts it on http://localhost:3001.

## Authentication

The product application uses Better Auth for verified email/password accounts and Google or GitHub OAuth, requires legal acceptance before signup, and uses organizations as its SaaS membership boundary. Follow the [authentication and transactional-email setup](SETUP.md#authentication-and-transactional-email) before testing account creation locally.

The Webapp owns authentication configuration, authorization boundaries, account UI, transactional auth email, and the Drizzle auth schema. Route guards control navigation, while Better Auth APIs and server-only functions enforce session and organization authorization.

## Licensing

Portions of this repository are licensed as follows:

- Files under [`www`](www), [`sdk`](sdk), and [`examples`](examples) are licensed under the [MIT License](LICENSE-MIT), except for third-party material governed by its applicable license.
- All other files in this repository are licensed under the [GNU Affero General Public License v3.0 only](LICENSE-AGPL) (`AGPL-3.0-only`), except where an adjacent license or notice states otherwise.
- Third-party components and materials are licensed under the applicable licenses provided by their respective owners. See [third-party notices](docs/legal/THIRD_PARTY_NOTICES.md).

Copyright © 2026 AstralBeam Inc. for AstralBeam-controlled material. Third-party material remains subject to its respective copyright and license terms.
