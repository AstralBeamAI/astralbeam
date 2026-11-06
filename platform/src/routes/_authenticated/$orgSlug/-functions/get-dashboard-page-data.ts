import { createServerFn } from "@tanstack/react-start"
import { Effect } from "effect"

import { ChatThreads } from "@/lib/chat/threads/threads"
import { Config } from "@/lib/config/config"
import { ModelProviders } from "@/lib/model-providers/model-providers.server"
import { organizationAccessMiddleware } from "@/lib/organizations/middleware"
import { Organizations } from "@/lib/organizations/organizations.server"
import { OrganizationRouteInputSchema } from "@/lib/organizations/schemas"
import { runEffect } from "@/lib/runtime/server-fn.server"
import { toValidationSchema } from "@/lib/schemas"

export const getDashboardPageData = createServerFn({ method: "GET" })
  .middleware([organizationAccessMiddleware()])
  .validator(toValidationSchema(OrganizationRouteInputSchema))
  .handler(({ context, serverFnMeta }) =>
    runEffect(
      Effect.gen(function* () {
        // Counting only what this role may read makes the serialized payload the authorization
        // boundary, rather than the cards the browser chooses to render.
        const { counts, modelSetup, hasAppReply, appBaseUrl } = yield* Effect.all(
          {
            appBaseUrl: Effect.flatMap(Config, (config) => config.get("app_base_url")),
            hasAppReply: context.permissions.readTenants
              ? Effect.flatMap(ChatThreads, (threads) =>
                  threads.hasCompletedReply({ organizationId: context.organizationId }),
                )
              : Effect.succeed(null),
            counts: Effect.flatMap(Organizations, (organizations) =>
              organizations.resourceCounts({
                organizationId: context.organizationId,
                permissions: context.permissions,
              }),
            ),
            modelSetup: context.permissions.readConfiguration
              ? Effect.flatMap(ModelProviders, (providers) =>
                  providers.setupState({ organizationId: context.organizationId }),
                )
              : Effect.succeed(null),
          },
          { concurrency: "unbounded" },
        )
        return {
          data: {
            organizationName: context.organizationName,
            // The snippets name this deployment, so self-hosted code works when pasted.
            apiUrl: new URL("/api", appBaseUrl).href,
            counts,
            modelSetup,
            hasAppReply,
          },
          permissions: context.permissions,
        }
      }),
      serverFnMeta.name,
    ),
  )
