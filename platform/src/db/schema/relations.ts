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
    apiKeys: relations.many.apiKey(),
    members: relations.many.member(),
    invitations: relations.many.invitation(),
    configuration: relations.one.organizationConfiguration(),
    sandboxProviders: relations.many.sandboxProvider(),
    tenants: relations.many.tenant(),
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
  sandboxProvider: {
    organization: relations.one.organization({
      from: relations.sandboxProvider.organizationId,
      to: relations.organization.id,
    }),
  },
  tenant: {
    organization: relations.one.organization({
      from: relations.tenant.organizationId,
      to: relations.organization.id,
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
  chatMessage: {
    parts: relations.many.chatMessagePart(),
  },
  chatMessagePart: {
    message: relations.one.chatMessage({
      from: [
        relations.chatMessagePart.organizationId,
        relations.chatMessagePart.tenantId,
        relations.chatMessagePart.threadId,
        relations.chatMessagePart.messageId,
      ],
      to: [
        relations.chatMessage.organizationId,
        relations.chatMessage.tenantId,
        relations.chatMessage.threadId,
        relations.chatMessage.id,
      ],
    }),
    responses: relations.many.chatToolResponse(),
  },
  chatToolResponse: {
    toolPart: relations.one.chatMessagePart({
      from: [
        relations.chatToolResponse.organizationId,
        relations.chatToolResponse.tenantId,
        relations.chatToolResponse.threadId,
        relations.chatToolResponse.toolPartId,
      ],
      to: [
        relations.chatMessagePart.organizationId,
        relations.chatMessagePart.tenantId,
        relations.chatMessagePart.threadId,
        relations.chatMessagePart.id,
      ],
    }),
  },
}))
