import { createServerFn } from "@tanstack/react-start"
import { Effect } from "effect"

import { Auth } from "@/lib/auth/auth.server"
import { organizationAccessMiddleware } from "@/lib/organizations/middleware"
import { OrganizationRouteInputSchema } from "@/lib/organizations/schemas"
import { effectHandler } from "@/lib/runtime/server-fn.server"
import { ServerRequest } from "@/lib/runtime/server-request.server"
import { toValidationSchema } from "@/lib/schemas"
import { membersPageQueries } from "../-lib/constants"

export const getMembersPageData = createServerFn({ method: "GET" })
  .middleware([organizationAccessMiddleware()])
  .validator(toValidationSchema(OrganizationRouteInputSchema))
  .handler(
    effectHandler(({ context }) =>
      Effect.gen(function* () {
        const queries = membersPageQueries(context.organizationId)
        const { headers } = (yield* ServerRequest).request
        const auth = yield* Auth
        const [members, owners, invitations] = yield* Effect.all(
          [
            auth.api((api) => api.listMembers({ headers, query: queries.members })),
            auth.api((api) => api.listMembers({ headers, query: queries.owners })),
            context.permissions.createInvitation
              ? auth.api((api) => api.listInvitations({ headers, query: queries.invitations }))
              : Effect.succeed([]),
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
    ),
  )
