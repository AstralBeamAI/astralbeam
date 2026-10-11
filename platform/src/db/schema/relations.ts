import { defineRelations, defineRelationsPart } from "drizzle-orm"

import * as schema from "./tables.ts"

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
    agents: relations.many.agent({
      from: relations.organization.id,
      to: relations.agent.organizationId,
    }),
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
    modelProviders: relations.many.modelProvider({
      from: relations.organization.id,
      to: relations.modelProvider.organizationId,
    }),
    providerModels: relations.many.providerModel({
      from: relations.organization.id,
      to: relations.providerModel.organizationId,
    }),
    agentModels: relations.many.agentModel({
      from: relations.organization.id,
      to: relations.agentModel.organizationId,
    }),
    sandboxProviders: relations.many.sandboxProvider({
      from: relations.organization.id,
      to: relations.sandboxProvider.organizationId,
    }),
    tenants: relations.many.tenant({
      from: relations.organization.id,
      to: relations.tenant.organizationId,
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
    tenantUsers: relations.many.tenantUser({
      from: [relations.tenant.organizationId, relations.tenant.id],
      to: [relations.tenantUser.organizationId, relations.tenantUser.tenantId],
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

const chatRelations = defineRelationsPart(schema, (relations) => ({
  chatThread: {
    tenant: relations.one.tenant({
      from: [relations.chatThread.organizationId, relations.chatThread.tenantId],
      to: [relations.tenant.organizationId, relations.tenant.id],
    }),
    participants: relations.many.chatParticipant({
      from: [
        relations.chatThread.organizationId,
        relations.chatThread.tenantId,
        relations.chatThread.id,
      ],
      to: [
        relations.chatParticipant.organizationId,
        relations.chatParticipant.tenantId,
        relations.chatParticipant.threadId,
      ],
    }),
    messages: relations.many.chatMessage({
      from: [
        relations.chatThread.organizationId,
        relations.chatThread.tenantId,
        relations.chatThread.id,
      ],
      to: [
        relations.chatMessage.organizationId,
        relations.chatMessage.tenantId,
        relations.chatMessage.threadId,
      ],
    }),
  },
  chatParticipant: {
    thread: relations.one.chatThread({
      from: [
        relations.chatParticipant.organizationId,
        relations.chatParticipant.tenantId,
        relations.chatParticipant.threadId,
      ],
      to: [
        relations.chatThread.organizationId,
        relations.chatThread.tenantId,
        relations.chatThread.id,
      ],
    }),
    tenantUser: relations.one.tenantUser({
      from: [
        relations.chatParticipant.organizationId,
        relations.chatParticipant.tenantId,
        relations.chatParticipant.tenantUserId,
      ],
      to: [
        relations.tenantUser.organizationId,
        relations.tenantUser.tenantId,
        relations.tenantUser.id,
      ],
    }),
  },
  chatMessage: {
    thread: relations.one.chatThread({
      from: [
        relations.chatMessage.organizationId,
        relations.chatMessage.tenantId,
        relations.chatMessage.threadId,
      ],
      to: [
        relations.chatThread.organizationId,
        relations.chatThread.tenantId,
        relations.chatThread.id,
      ],
    }),
    parts: relations.many.chatMessagePart({
      from: [
        relations.chatMessage.organizationId,
        relations.chatMessage.tenantId,
        relations.chatMessage.threadId,
        relations.chatMessage.id,
      ],
      to: [
        relations.chatMessagePart.organizationId,
        relations.chatMessagePart.tenantId,
        relations.chatMessagePart.threadId,
        relations.chatMessagePart.messageId,
      ],
    }),
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
    responses: relations.many.chatToolResponse({
      from: [
        relations.chatMessagePart.organizationId,
        relations.chatMessagePart.tenantId,
        relations.chatMessagePart.threadId,
        relations.chatMessagePart.id,
      ],
      to: [
        relations.chatToolResponse.organizationId,
        relations.chatToolResponse.tenantId,
        relations.chatToolResponse.threadId,
        relations.chatToolResponse.toolPartId,
      ],
    }),
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
    resultMessage: relations.one.chatMessage({
      from: [
        relations.chatToolResponse.organizationId,
        relations.chatToolResponse.tenantId,
        relations.chatToolResponse.threadId,
        relations.chatToolResponse.resultMessageId,
      ],
      to: [
        relations.chatMessage.organizationId,
        relations.chatMessage.tenantId,
        relations.chatMessage.threadId,
        relations.chatMessage.id,
      ],
    }),
  },
}))

const filesRelations = defineRelationsPart(schema, (relations) => ({
  fileObject: {
    user: relations.one.user({
      from: relations.fileObject.userId,
      to: relations.user.id,
    }),
    organization: relations.one.organization({
      from: relations.fileObject.organizationId,
      to: relations.organization.id,
    }),
  },
}))

// Relation parts follow the base definition, and each source table belongs to one part. https://orm.drizzle.team/docs/relations#relations-parts
export const databaseRelations = {
  ...baseRelations,
  ...authRelations,
  ...chatRelations,
  ...filesRelations,
}
