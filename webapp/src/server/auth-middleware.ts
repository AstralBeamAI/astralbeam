import { createMiddleware } from "@tanstack/react-start"
import { setResponseStatus } from "@tanstack/react-start/server"

import { getOrganizationMembershipServerOnly } from "./session.functions"

export const organizationMiddleware = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const membership = await getOrganizationMembershipServerOnly({ disableCookieCache: true })
    if (!membership) {
      setResponseStatus(401)
      throw new Error("Unauthorized")
    }
    if (!membership.member) {
      setResponseStatus(403)
      throw new Error("An active organization membership is required")
    }

    return next({
      context: {
        organizationActor: {
          organizationId: membership.member.organizationId,
          role: membership.member.role,
          userId: membership.user.id,
        },
      },
    })
  },
)
