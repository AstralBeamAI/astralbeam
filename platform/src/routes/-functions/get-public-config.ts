import { createServerFn } from "@tanstack/react-start"
import { Effect } from "effect"

import { getDatabaseBootstrapIssues } from "@/db/lib/database-credentials"
import { Config } from "@/lib/config/config"
import { runEffect } from "@/lib/runtime/server-fn.server"

/** `null` until setup completes, including while no database is configured. */
export const getPublicConfig = createServerFn({ method: "GET" }).handler(({ serverFnMeta }) =>
  getDatabaseBootstrapIssues().length > 0
    ? null
    : runEffect(
        Effect.flatMap(Config, (config) => config.publicConfig),
        serverFnMeta.name,
      ),
)
