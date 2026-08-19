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

There are three independent Deno projects: a TanStack Start product application with app-local shadcn/ui components, the public Astro website, and the frontend SDK published to npm.

```text
webapp/       # TanStack Start application, database, theme, and UI
www/          # Public website
sdk/          # Frontend SDK, published to npm as @astralbeam/sdk
```


## Local development

Choose either the included devcontainer or the direct macOS workflow. Follow [`SETUP.md`](SETUP.md) for prerequisites and the PostgreSQL and Valkey service lifecycle.

```sh
./scripts/setup.sh          # Install Deno and the projects' dependencies
cd webapp && deno task dev  # Starts app on http://localhost:3000
cd www && deno task dev     # Starts website on http://localhost:3001
```

## Licensing

Portions of this repository are licensed as follows:

- Files under [`www`](www) and [`sdk`](sdk) are licensed under the [MIT License](LICENSE-MIT), except for third-party material governed by its applicable license.
- All other files in this repository are licensed under the [GNU Affero General Public License v3.0 only](LICENSE-AGPL) (`AGPL-3.0-only`), except where an adjacent license or notice states otherwise.
- Third-party components and materials are licensed under the applicable licenses provided by their respective owners. See [third-party notices](docs/legal/THIRD_PARTY_NOTICES.md).

Copyright © 2026 AstralBeam Inc. for AstralBeam-controlled material. Third-party material remains subject to its respective copyright and license terms.
