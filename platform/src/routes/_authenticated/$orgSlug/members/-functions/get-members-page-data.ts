import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import { Effect } from "effect"

import { Auth } from "@/lib/auth/auth.server"
import { organizationAccessMiddleware } from "@/lib/organizations/middleware"
import { OrganizationRouteInputSchema } from "@/lib/organizations/schemas"
import { runEffect } from "@/lib/runtime/server-fn.server"
import { toValidationSchema } from "@/lib/schemas"
import { membersPageQueries } from "../-lib/constants"

export const getMembersPageData = createServerFn({ method: "GET" })
  .middleware([organizationAccessMiddleware()])
  .validator(toValidationSchema(OrganizationRouteInputSchema))
  .handler(({ context, serverFnMeta }) => {
    const headers = getRequest().headers
    const queries = membersPageQueries(context.organizationId)
    return runEffect(
      Effect.gen(function* () {
        const auth = yield* Auth
        const [members, owners, invitations] = yield* Effect.all(
          [
            auth.api((api) => api.listMembers({ headers, query: queries.members })),
            auth.api((api) => api.listMembers({ headers, query: queries.owners })),
            auth.api((api) => api.listInvitations({ headers, query: queries.invitations })),
          ],
          { concurrency: "unbounded" },
        )
        return {
          data: {
            organization: {
              id: context.organizationId,
              name: context.organizationName,
              slug: context.organizationSlug,
            },
            memberRole: context.role,
            members,
            owners,
            invitations,
          },
          permissions: context.permissions,
        }
      }),
      serverFnMeta.name,
    )
  })
