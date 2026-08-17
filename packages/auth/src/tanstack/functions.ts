import { db } from "@astralbeam/db"
import { member } from "@astralbeam/db/schema"
import { createServerFn, createServerOnlyFn } from "@tanstack/react-start"
import { getRequestHeaders, setResponseHeader } from "@tanstack/react-start/server"
import { and, eq } from "drizzle-orm"

import { auth } from "../auth"

interface SessionQuery {
  disableCookieCache?: boolean
}

export const getAuthSessionServerOnly = createServerOnlyFn(async (query?: SessionQuery) => {
  const session = await auth.api.getSession({
    headers: getRequestHeaders(),
    query,
    returnHeaders: true,
  })

  const cookies = session.headers?.getSetCookie()
  if (cookies?.length) setResponseHeader("Set-Cookie", cookies)

  return session.response ?? null
})

export const getUserServerOnly = createServerOnlyFn(async (query?: SessionQuery) => {
  const session = await getAuthSessionServerOnly(query)
  return session?.user ?? null
})

export const getOrganizationMembershipServerOnly = createServerOnlyFn(
  async (query?: SessionQuery) => {
    const authSession = await getAuthSessionServerOnly(query)
    if (!authSession) return null

    const organizationId = authSession.session.activeOrganizationId
    if (!organizationId) return { member: null, user: authSession.user }

    const [activeMember] = await db
      .select({
        id: member.id,
        organizationId: member.organizationId,
        role: member.role,
      })
      .from(member)
      .where(and(eq(member.userId, authSession.user.id), eq(member.organizationId, organizationId)))
      .limit(1)

    return { member: activeMember ?? null, user: authSession.user }
  },
)

export const getActiveMemberServerOnly = createServerOnlyFn(async (query?: SessionQuery) => {
  const organizationMembership = await getOrganizationMembershipServerOnly(query)
  return organizationMembership?.member ?? null
})

export const $getSession = createServerFn({ method: "GET" }).handler(() =>
  getAuthSessionServerOnly(),
)

export const $getActiveMember = createServerFn({ method: "GET" }).handler(() =>
  // Route transitions must observe organization changes immediately instead of the cookie cache's previous active organization. https://better-auth.com/docs/concepts/session-management#cookie-cache
  getActiveMemberServerOnly({ disableCookieCache: true }),
)
