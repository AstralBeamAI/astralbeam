import { createServerFn } from "@tanstack/react-start"
import { Effect } from "effect"

import { ChatThreads } from "@/lib/chat/threads/threads"
import { organizationAccessMiddleware } from "@/lib/organizations/middleware"
import { OrganizationRouteInputSchema } from "@/lib/organizations/schemas"
import { effectHandler } from "@/lib/runtime/server-fn.server"
import { toValidationSchema } from "@/lib/schemas"

/** Polled by the integration guide until the organization's app receives its first reply. */
export const getAppReplyStatus = createServerFn({ method: "GET" })
  .middleware([organizationAccessMiddleware({ tenantManagement: ["read"] })])
  .validator(toValidationSchema(OrganizationRouteInputSchema))
  .handler(
    effectHandler(({ context }) =>
      Effect.flatMap(ChatThreads, (threads) =>
        threads.hasCompletedReply({ organizationId: context.organizationId }),
      ),
    ),
  )
