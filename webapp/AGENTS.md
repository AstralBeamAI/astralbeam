## Codebase Structure and Guidelines

- This is TanStack Start React app, and all app code lives inside `src`, everything outside is configuration
     - `deno` is the runtime cum package manager. all useful commands are listed in `package.json`

- `src/components/ui` contains shadcn-ui components and should never be edited/linted/formatted
    - New components should only be added using `deno x shadcn@latest <component>` 
- `src/components` contains common components used throught the application

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
            - name `my-custom-component.tsx` for `<MyCustomComoponent />`
        - `-functions`: Contains server functions used only in that route file
            - one server function per file, with proper middleware & authorization check
            - use the proper HTTTP method (GET or POST or DELETE) depending on what the server function does
            - name `update-xyz-data` for the function `updateXYZData` normal export (not default)
            - validate server functions using `.validator` (typically a zod schema, but can be plain text)
        - `-lib`: Contains helper functions `utils.ts`, database queries `db.ts` specific to the route
            - Don't create separate files for utiliies, put them in `utils.ts` and `utils.server.ts`
            - Always put constants in a `constants.ts` or `constants.server.ts` files
            - each function in `-lib/db.ts` should typically wrap one db query / transaction and return its result
            - `-lib/types.ts` can contain any types specif to the route.
    - If multiple routes use the same component/function/helper, lift it up to the closest common ancestor
        - Exception: somtimes when one route _SHOULD OWN_ a component/function used elsewhere, keep it close to the route
    - Routes might someimtes be layout routes and may render an `<Outlet />` which then renders the child routes
        - Avoid heavy layout nesting, do it only when it makes sense. 
        - For layout routes, somtimes it's better to avoid the `index.tsx` file in `my/route/path/index.ts/tsx` (use your judgement)
    - Routes that do not render pages might be server routes (`createFileRoute({ server ... }))`
        - The are typically place in the `routes/api` folder unless there's a strong reason to have them outside.
    - Related routes can sometimes be grouped together using a route group folder e.g. `(auth)` if it better structures the codebase

- `src/db` contains the database schema and migrations
    - `index.server.ts` contains the databse connection and drizzle db object
    - `schema.server.ts` contains the drizzle schema
    - `migrations` contains the drizzle migrations

- `src/lib` contains application-wide shared code like:
    - `utils.ts`: utility functions
    - `utils.server.ts`: server-only utilities
    - `config.server.ts`: server-side environment variables (from process.env using `ensureServerEnv`) - always read them from this file
        - can also contain some global constants
    - `config.ts`: constants and environment variables readable from both server and client 
    - `types.ts`: common types used across the application
    - `auth.ts` contains the better-auth setup for authentication
    - avoid creating new files in `src/lib`, use new code goes into one of the above files or into a module-specific `-lib` folder.

- `src/emails` contains emails powered by react-email (TODO: not set up yet, add more docs later)

- Server functions and server routes should generally be guarded by middleware e.g. authMiddleware unless there's strong reason not to

- While writing DB queries, always put in the right authorization checks to avoid leaking one user/org's data to another

- After every major change, look for opportunities to reuse or refactor code (components, server functions, db queries etc.)
    - in general, as more patterns emerge across routes/modules, lift up the reusable code to common ancestors
    - be especially careful with types, it is very easy to end up with heavy type duplication with minor changes

- IMPORTANT SECURITY CHECKS after implementing new features:
    - In `beforeLoad` you might need to check if the page is actually accessible to the curent user
    - In every server function, you might need to check if the current user is authorized to access & update the data
    - In every databsae query, you might need to ensures that the right filters are applied to avoid leaking data accidentally
    - Errors in the backend must be handled, logged and gracefully shown to a user to convey why something didn't work without leaking critical info that might compromise the application security.
    - Server-only code should typically go into `*.server.ts` files. be careful not to leak server environment vars into the client.

TODO: add common commands

