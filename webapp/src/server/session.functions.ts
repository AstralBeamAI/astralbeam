import { createServerFn, createServerOnlyFn } from "@tanstack/react-start"
import { getRequestHeaders, setResponseHeader } from "@tanstack/react-start/server"
import { and, eq } from "drizzle-orm"

import { member } from "@/db/schema.server"

export interface SessionQuery {
  disableCookieCache?: boolean
}

const getSessionServerOnly = createServerOnlyFn(async (query?: SessionQuery) => {
  const { auth } = await import("./auth.server")
  const session = await auth.api.getSession({
    headers: getRequestHeaders(),
    query,
    returnHeaders: true,
  })

  const cookies = session.headers?.getSetCookie()
  if (cookies?.length) setResponseHeader("Set-Cookie", cookies)

  return session.response ?? null
})

export const getOrganizationMembershipServerOnly = createServerOnlyFn(
  async (query?: SessionQuery) => {
    const authSession = await getSessionServerOnly(query)
    if (!authSession) return null

    const organizationId = authSession.session.activeOrganizationId
    if (!organizationId) return { member: null, user: authSession.user }

    const { database } = await import("@/db/database.server")
    const [activeMember] = await database
      .select({ id: member.id, organizationId: member.organizationId, role: member.role })
      .from(member)
      .where(and(eq(member.userId, authSession.user.id), eq(member.organizationId, organizationId)))
      .limit(1)

    return { member: activeMember ?? null, user: authSession.user }
  },
)

export const getSession = createServerFn({ method: "GET" }).handler(() => getSessionServerOnly())

export const getActiveOrganizationMembership = createServerFn({ method: "GET" }).handler(() =>
  getOrganizationMembershipServerOnly({ disableCookieCache: true })
)
