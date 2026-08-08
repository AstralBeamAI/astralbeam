# AstralBeam

A Vite+ monorepo with a TanStack Start application and shared shadcn/ui components.

```text
apps/
  webapp/       @astralbeam/webapp  # TanStack Start application
  www/          @astralbeam/www     # Public website
  www-old/      @astralbeam/www-old # Previous public website
packages/
  brand/        @astralbeam/brand   # Approved SVG and PNG brand assets
  db/           @astralbeam/db      # Server-only Drizzle client and schemas
  ui/           @astralbeam/ui      # Shared styles, components, and utilities
```

## Local development

Choose either the included devcontainer or the direct macOS workflow. Follow [`SETUP.md`](SETUP.md) for prerequisites and the PostgreSQL and Valkey service lifecycle.

```sh
vp install
vp run webapp # Starts app on http://localhost:3000
vp run www # Starts website on http://localhost:3001
```

Add shadcn components to the shared UI package:

```sh
vp run ui add button
```

## Validate and build

- Run formatting, linting, and TypeScript checks:

  ```sh
  vp run check
  ```

- Run tests:

  ```sh
  vp run test
  ```

- Build the product application:

  ```sh
  vp run @astralbeam/webapp#build
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
