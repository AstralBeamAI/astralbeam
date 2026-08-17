import { defineRelations } from "drizzle-orm"

import {
  account,
  invitation,
  member,
  organization,
  rateLimit,
  session,
  user,
  verification,
} from "./auth"

export const relations = defineRelations(
  { account, invitation, member, organization, rateLimit, session, user, verification },
  () => ({}),
)
