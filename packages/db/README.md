# `@astralbeam/db`

Server-only PostgreSQL access for AstralBeam applications.

## Query from a server function

Once a table is exported from the schema entrypoint, consume it from a server-only module:

```ts
import { db } from "@astralbeam/db"
import { projects } from "@astralbeam/db/schema"
import { createServerFn } from "@tanstack/react-start"

export const listProjects = createServerFn({ method: "GET" }).handler(() =>
  db.select().from(projects),
)
```

`db` is the shared Drizzle client. The schema entrypoint exports the available tables and relations. Both require server-only code and `DATABASE_URL`.
