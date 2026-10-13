# Finding your way around the platform

This page is a map of `platform/src`. Read it once and you should know where any piece of code lives, how a request travels through it, and where new code belongs. The rules behind the map are in [platform/AGENTS.md](../AGENTS.md).

## The map

```text
src/
├─ routes/          Pages and HTTP endpoints, one folder per URL
│  ├─ _authenticated/$orgSlug/agents/   A dashboard page and everything only it uses
│  │  ├─ index.tsx       The page, its loader, and its skeleton
│  │  ├─ -components/    Components only this page renders
│  │  ├─ -functions/     Server functions this page calls
│  │  └─ -lib/           Helpers and schemas only this page needs
│  ├─ api/v1/       The public REST and chat API
│  ├─ configure/    The operator setup page
│  └─ docs/         The documentation site
├─ components/      Components shared by several pages
├─ lib/             Everything that is not UI, one folder per module
│  ├─ runtime/      How Effect code runs, and how failures are reported
│  ├─ agents/       Agents
│  ├─ organizations/  Organizations, membership, and access checks
│  ├─ auth/         Better Auth, sessions, and tokens
│  ├─ api-keys/     Organization API key credentials
│  ├─ tenants/      Tenants and tenant users
│  ├─ sandboxes/    Sandbox providers
│  ├─ chat/         Chat runs, with attachments/ and sandbox/ inside
│  ├─ email/        Sending email
│  ├─ config/       Deployment settings
│  ├─ dogfood/      The deployment's own organization
│  └─ cluster/ workflows/   Durable background work
├─ db/              Database connection, tables, and migrations
└─ emails/          Email templates
```

The same shape repeats at every level. A route folder keeps what only it uses in `-components`, `-functions`, and `-lib`, and anything two routes share moves up to their closest common folder, all the way to `src/components` and `src/lib`. A module grows child modules the same way, as `lib/chat/attachments` does.

## One module, up close

Folders in `src/lib` that mix server and shared code follow the `src/lib/agents` example:

| File                    | Holds                                                                  |
| ----------------------- | ---------------------------------------------------------------------- |
| `agents.server.ts`      | The `Agents` service: its methods and the layer that builds it         |
| `errors.ts`             | Every way an agent operation can fail, each with the message users see |
| `schemas.ts`            | Shapes shared with the browser, such as a valid agent name             |
| `agents.server.test.ts` | Tests, next to the file they test                                      |

TanStack import protection in `vite.config.ts` keeps `.server.ts` modules and protected directories out of the browser runtime graph. Files in those directories omit the `.server` filename suffix. Page code may import shared runtime modules from unprotected directories and use explicit type-only imports from protected modules.

## How a request runs

1. **A page loads.** Its loader calls a server function in the page's `-functions` folder, for example `getAgentsPageData`.
2. **The server function checks access and runs one Effect.** Middleware resolves the organization and the member's permissions, then the handler asks a service for the work: `Effect.flatMap(Agents, (agents) => agents.list(organizationId))`.
3. **The service does the work.** `Agents` queries the database through the `Database` service and returns plain data or a typed error.
4. **`runEffect` turns the result into what TanStack expects.** Data goes back to the page. An error the handler chose to show, such as `AgentNameTaken`, arrives as `[AgentNameTaken] An agent with this name already exists`. Anything else arrives as `[InternalError] Something went wrong. Reference: 9f6d70b3`.

The REST API under `routes/api/v1` follows the same path, with Effect's HttpApi in place of server functions and RFC 9457 problem bodies in place of the bracketed message. Server routes such as `/api/auth` run through `runRouteEffect`.

## When something fails

Users only ever see messages written for them. Every other failure is logged exactly once, with the operation, the reference the user saw, the error type, the database's SQLSTATE, and the chain of service methods it passed through. Raw error messages are never logged, because they can contain SQL parameters or secrets.

To investigate a report, search the server log for the reference:

```sh
journalctl -u astralbeam-platform | grep 9f6d70b3
```

## Adding something

1. **A new page:** add a folder under `routes`, with its loader calling a server function in its own `-functions`.
2. **New server logic:** add a method to the module's service, or a new module in `src/lib` with the same four files, and register its layer in `src/lib/runtime/runtime.server.ts`.
3. **A new failure users should see:** add a class to the module's `errors.ts` with its message and HTTP status, and expose it in the server function with `Effect.catchTag`.
4. **A new table:** define it in `src/db/schema`, then generate and review a migration as the [database guide](db/README.md) describes.
