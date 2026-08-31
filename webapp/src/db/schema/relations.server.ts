import { defineRelations, defineRelationsPart } from "drizzle-orm"

import * as schema from "./tables.server.ts"

const baseRelations = defineRelations(schema)

const authRelations = defineRelationsPart(schema, (relations) => ({
  user: {
    sessions: relations.many.session({
      from: relations.user.id,
      to: relations.session.userId,
    }),
    accounts: relations.many.account({
      from: relations.user.id,
      to: relations.account.userId,
    }),
    members: relations.many.member({
      from: relations.user.id,
      to: relations.member.userId,
    }),
    invitations: relations.many.invitation({
      from: relations.user.id,
      to: relations.invitation.inviterId,
    }),
  },
  session: {
    user: relations.one.user({
      from: relations.session.userId,
      to: relations.user.id,
    }),
  },
  account: {
    user: relations.one.user({
      from: relations.account.userId,
      to: relations.user.id,
    }),
  },
  organization: {
    apiKeys: relations.many.apiKey({
      from: relations.organization.id,
      to: relations.apiKey.organizationId,
    }),
    members: relations.many.member({
      from: relations.organization.id,
      to: relations.member.organizationId,
    }),
    invitations: relations.many.invitation({
      from: relations.organization.id,
      to: relations.invitation.organizationId,
    }),
    configuration: relations.one.organizationConfiguration({
      from: relations.organization.id,
      to: relations.organizationConfiguration.organizationId,
    }),
  },
  apiKey: {
    organization: relations.one.organization({
      from: relations.apiKey.organizationId,
      to: relations.organization.id,
    }),
  },
  organizationConfiguration: {
    organization: relations.one.organization({
      from: relations.organizationConfiguration.organizationId,
      to: relations.organization.id,
    }),
  },
  member: {
    organization: relations.one.organization({
      from: relations.member.organizationId,
      to: relations.organization.id,
    }),
    user: relations.one.user({
      from: relations.member.userId,
      to: relations.user.id,
    }),
  },
  invitation: {
    organization: relations.one.organization({
      from: relations.invitation.organizationId,
      to: relations.organization.id,
    }),
    user: relations.one.user({
      from: relations.invitation.inviterId,
      to: relations.user.id,
    }),
  },
}))

// Relation parts follow the base definition, and each source table belongs to one part. https://orm.drizzle.team/docs/relations#relations-parts
export const databaseRelations = {
  ...baseRelations,
  ...authRelations,
}
