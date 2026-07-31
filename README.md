# AstralBeam

Vite+ monorepo with a TanStack Start application and shared shadcn/ui components.

```text
apps/
  webapp/       @astralbeam/webapp
  www/          @astralbeam/www
packages/
  brand/        @astralbeam/brand
  db/           @astralbeam/db
  ui/           @astralbeam/ui
```

## Run the applications

Use the included devcontainer, then install the workspace and start the product application:

```sh
vp install
vp run dev
```

Run the public website separately:

```sh
vp run @astralbeam/www#dev
```

The devcontainer provides PostgreSQL and exports the `DATABASE_URL` required by database-backed server modules.

## Shared packages

- [`@astralbeam/brand`](packages/brand/README.md) exposes approved SVG and PNG brand assets.
- [`@astralbeam/db`](packages/db/README.md) exposes the server-only Drizzle client and schema definitions.
- [`@astralbeam/ui`](packages/ui/README.md) exposes shared styles, components, and utilities.

## Validate and build

Run formatting, linting, and TypeScript checks:

```sh
vp run check
```

Run tests and build the product application:

```sh
vp run test
vp run build
```

Add shadcn components to the shared UI package:

```sh
vp run ui add button
```

## Tasks

- [ ] How to Create Server Routes
- [ ] Add Better Auth
- [ ] Add react-email
- [ ] Update to Latest TanStack Start API (if needed)
- [ ] Set up CLAUDE.md properly
- [ ] Claude Worktree Workflow (3 agents together)
- [ ] Explain recommended folder structure
- [ ] Example of how to use effect-ts
- [ ] Deployment on Cloud VM (Hetzner/AWS)
- [ ] how to set up middleware
