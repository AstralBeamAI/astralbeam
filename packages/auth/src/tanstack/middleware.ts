import { createMiddleware } from "@tanstack/react-start"
import { setResponseStatus } from "@tanstack/react-start/server"

import { getOrganizationMembershipServerOnly, getUserServerOnly } from "./functions"

function createAuthMiddleware(disableCookieCache = false) {
  return createMiddleware({ type: "function" }).server(async ({ next }) => {
    const user = await getUserServerOnly(
      disableCookieCache ? { disableCookieCache: true } : undefined,
    )

    if (!user) {
      setResponseStatus(401)
      throw new Error("Unauthorized")
    }

    return next({ context: { user } })
  })
}

export const authMiddleware = createAuthMiddleware()
export const freshAuthMiddleware = createAuthMiddleware(true)

function createOrganizationMiddleware(disableCookieCache = false) {
  return createMiddleware({ type: "function" }).server(async ({ next }) => {
    const organizationMembership = await getOrganizationMembershipServerOnly(
      disableCookieCache ? { disableCookieCache: true } : undefined,
    )

    if (!organizationMembership) {
      setResponseStatus(401)
      throw new Error("Unauthorized")
    }

    const { member, user } = organizationMembership

    if (!member) {
      setResponseStatus(403)
      throw new Error("An active organization membership is required")
    }

    return next({
      context: {
        user,
        organization: {
          id: member.organizationId,
          memberId: member.id,
          role: member.role,
        },
      },
    })
  })
}

export const organizationMiddleware = createOrganizationMiddleware()
export const freshOrganizationMiddleware = createOrganizationMiddleware(true)
