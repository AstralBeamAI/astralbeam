## Codebase Structure and Guidelines

- This is a TanStack Start React app. Application code lives under `src`; files outside it configure the project.
  - Deno is the runtime and package manager; useful project tasks are listed in `package.json`.

- `src/components/ui` contains shadcn registry components and is excluded from Deno formatting, but not from linting or Knip unused-file discovery.
  - Add components only with `deno task ui add <component>`.
  - Use a `// Added with: deno task ui add <component>` top comment with every intentional local change; do not include `--overwrite` or `-y` in that comment.
  - Let Knip delete unreachable registry files, while suppressing only generated export-level noise.
- `src/components` contains common components used throughout the application.

- `src/routes` contains routes, as expected by TanStack Router:
  - Prefer `routes/my/route/path/index.ts/tsx` to `route/my/route/path.ts/tsx` in general for better code organization
  - Prefer folder based route structuring (a/b/c.tsx) over flat routes (a.b.c.tsx) unless there's good reason not to
    - Good reasons: avoiding very deep nesting, organizing related routes together
  - Routes which render web pages typically contain:
    - A `Route` export that uses `createFileRoute` and specifies a `component`
    - The route typically also contain `loader`, `pendingComponent` and somtimes `beforeLoad`
    - The main component which renders the page (typically `XYZPage`) defined below the route
    - The pending component (typically `XYZPageSkeleton`) show a skeleton UI matching page layout
    - The loader might typically invoke a server function (e.g. `loadXYZPageData`) to load the data for the page.
    - The main component might typically use import and use other react components
    - The main component (or the components it uses) can use server functions for mutations (e.g. `updateXYZ`)
  - A route file may have the following folders next to it for colocation of logic:
    - `-components`: Contains components used only in that route file
      - one component per file, use normal exports (not default)
      - name `my-custom-component.tsx` for `<MyCustomComponent />`
    - `-functions`: Contains server functions used only in that route file
      - one server function per file, with proper middleware & authorization check
      - use the proper HTTP method (GET, POST, or DELETE) depending on what the server function does
      - name `update-xyz-data` for the function `updateXYZData` normal export (not default)
      - validate server functions using `.validator` (typically a zod schema, but can be plain text)
    - `-lib`: Contains helper functions `utils.ts`, database queries `db.ts` specific to the route
      - Don't create separate files for utilities; put them in `utils.ts` and `utils.server.ts`
      - Always put constants in a `constants.ts` or `constants.server.ts` files
      - each function in `-lib/db.ts` should typically wrap one db query / transaction and return its result
      - `-lib/types.ts` can contain types specific to the route.
  - If multiple routes use the same component/function/helper, lift it up to the closest common ancestor
    - Exception: somtimes when one route _SHOULD OWN_ a component/function used elsewhere, keep it close to the route
  - Routes might sometimes be layout routes and may render an `<Outlet />` which then renders the child routes
    - Avoid heavy layout nesting, do it only when it makes sense.
    - For layout routes, sometimes it's better to avoid the `index.tsx` file in `my/route/path/index.tsx` (use your judgement)
  - Routes that do not render pages might be server routes (`createFileRoute({ server ... }))`
    - They are typically placed in the `routes/api` folder unless there's a strong reason to have them outside.

- `src/db` contains the database schema and migrations
  - `schema.server.ts` re-exports every table and relation Drizzle Kit must discover; keep domain schema definitions in responsibility-named `*.server.ts` files.
  - Define tables with `snakeCase.table` and camel-case TypeScript keys so Drizzle derives lower snake-case SQL column names.
  - Both audit columns use `DEFAULT now()`; Drizzle's `updatedAt` `$onUpdateFn` hook returns PostgreSQL `now()` but does not create a database trigger, so non-Drizzle updates must set `updated_at` explicitly.
  - Preserve required extension DDL such as `CREATE EXTENSION IF NOT EXISTS citext` when regenerating an unmerged migration.
  - `migrations` contains the drizzle migrations

- `src/emails` contains emails powered by react-email (TODO: not set up yet, add more docs later)

- Server functions and server routes should generally be guarded by middleware e.g. authMiddleware unless there's strong reason not to

- While writing database queries, include the authorization filters needed to avoid leaking one user or organization's data to another.

- Keep only tests that protect durable behavior, security boundaries, or regressions; avoid trivial assertions over constants, generated files, and implementation structure.

- After every major change, look for opportunities to reuse or refactor code (components, server functions, db queries etc.)
  - in general, as more patterns emerge across routes/modules, lift up the reusable code to common ancestors
  - be especially careful with types, it is very easy to end up with heavy type duplication with minor changes

- IMPORTANT SECURITY CHECKS after implementing new features:
  - In `beforeLoad` you might need to check if the page is actually accessible to the current user
  - In every server function, you might need to check if the current user is authorized to access & update the data
  - In every database query, ensure that the right filters are applied to avoid leaking data accidentally
  - Errors in the backend must be handled, logged and gracefully shown to a user to convey why something didn't work without leaking critical info that might compromise the application security.
  - Server-only code should typically go into `*.server.ts` files. be careful not to leak server environment vars into the client.

TODO: add common commands
