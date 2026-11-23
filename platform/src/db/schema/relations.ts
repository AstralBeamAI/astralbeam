import { defineRelations } from "drizzle-orm"

import * as schema from "./tables.ts"

export const databaseRelations = defineRelations(schema, (relations) => ({
  user: {
    sessions: relations.many.session(),
    accounts: relations.many.account(),
    members: relations.many.member(),
    invitations: relations.many.invitation(),
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
    agents: relations.many.agent({
      from: relations.organization.id,
      to: relations.agent.organizationId,
    }),
    members: relations.many.member(),
    invitations: relations.many.invitation(),
    configuration: relations.one.organizationConfiguration({
      from: relations.organization.id,
      to: relations.organizationConfiguration.organizationId,
    }),
    sandboxProviders: relations.many.sandboxProvider({
      from: relations.organization.id,
      to: relations.sandboxProvider.organizationId,
    }),
  },
  agent: {
    models: relations.many.agentModel({
      from: [relations.agent.organizationId, relations.agent.id],
      to: [relations.agentModel.organizationId, relations.agentModel.agentId],
    }),
  },
  agentModel: {
    model: relations.one.providerModel({
      from: [relations.agentModel.organizationId, relations.agentModel.providerModelId],
      to: [relations.providerModel.organizationId, relations.providerModel.id],
    }),
  },
  modelProvider: {
    models: relations.many.providerModel(),
  },
  providerModel: {
    provider: relations.one.modelProvider({
      from: [relations.providerModel.organizationId, relations.providerModel.modelProviderId],
      to: [relations.modelProvider.organizationId, relations.modelProvider.id],
    }),
  },
  tenantUser: {
    tenant: relations.one.tenant({
      from: [relations.tenantUser.organizationId, relations.tenantUser.tenantId],
      to: [relations.tenant.organizationId, relations.tenant.id],
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
