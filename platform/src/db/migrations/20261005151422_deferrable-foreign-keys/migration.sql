ALTER TABLE "chat_message" DROP CONSTRAINT "chat_message_parent_fk";
--> statement-breakpoint
ALTER TABLE "chat_message" DROP CONSTRAINT "chat_message_turn_fk";
--> statement-breakpoint
ALTER TABLE "chat_message_part" DROP CONSTRAINT "chat_message_part_FBudTaTR7Xcv_fkey";
--> statement-breakpoint
ALTER TABLE "chat_thread" DROP CONSTRAINT "chat_thread_current_leaf_fk";
--> statement-breakpoint
ALTER TABLE "chat_tool_response" DROP CONSTRAINT "chat_tool_response_uc05DjAdWyKZ_fkey";
--> statement-breakpoint
ALTER TABLE "chat_tool_response" DROP CONSTRAINT "chat_tool_response_result_fk";
--> statement-breakpoint
DROP INDEX "chat_message_thread_id_uidx";
--> statement-breakpoint
DROP INDEX "chat_message_part_thread_id_uidx";
--> statement-breakpoint
ALTER TABLE "chat_message" DROP CONSTRAINT "chat_message_pkey";
--> statement-breakpoint
ALTER TABLE "chat_message" ADD PRIMARY KEY ("organization_id","tenant_id","thread_id","id");
--> statement-breakpoint
ALTER TABLE "chat_message_part" DROP CONSTRAINT "chat_message_part_pkey";
--> statement-breakpoint
ALTER TABLE "chat_message_part" ADD PRIMARY KEY ("organization_id","tenant_id","thread_id","id");
--> statement-breakpoint
DROP INDEX "chat_message_part_position_uidx";
--> statement-breakpoint
CREATE UNIQUE INDEX "chat_message_part_position_uidx" ON "chat_message_part" ("organization_id","tenant_id","thread_id","message_id","position");
--> statement-breakpoint
DROP INDEX "chat_tool_response_result_uidx";
--> statement-breakpoint
CREATE UNIQUE INDEX "chat_tool_response_result_uidx" ON "chat_tool_response" ("organization_id","tenant_id","thread_id","result_message_id") WHERE "result_message_id" is not null;
--> statement-breakpoint
ALTER TABLE "agent" DROP CONSTRAINT "agent_organization_id_sandbox_provider_id_fk", ADD CONSTRAINT "agent_organization_id_sandbox_provider_id_fk" FOREIGN KEY ("organization_id","sandbox_provider_id") REFERENCES "sandbox_provider"("organization_id","id") DEFERRABLE INITIALLY IMMEDIATE;
--> statement-breakpoint
ALTER TABLE "agent_model" DROP CONSTRAINT "agent_model_provider_model_fk", ADD CONSTRAINT "agent_model_provider_model_fk" FOREIGN KEY ("organization_id","provider_model_id") REFERENCES "provider_model"("organization_id","id") DEFERRABLE INITIALLY IMMEDIATE;
--> statement-breakpoint
ALTER TABLE "chat_thread" DROP CONSTRAINT "chat_thread_agent_fk", ADD CONSTRAINT "chat_thread_agent_fk" FOREIGN KEY ("organization_id","agent_id") REFERENCES "agent"("organization_id","id") ON DELETE SET NULL ("agent_id") DEFERRABLE INITIALLY IMMEDIATE;
--> statement-breakpoint
ALTER TABLE "organization_configuration" DROP CONSTRAINT "organization_configuration_default_agent_id_fk", ADD CONSTRAINT "organization_configuration_default_agent_id_fk" FOREIGN KEY ("organization_id","default_agent_id") REFERENCES "agent"("organization_id","id") DEFERRABLE INITIALLY IMMEDIATE;
--> statement-breakpoint
ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_parent_fk" FOREIGN KEY ("organization_id","tenant_id","thread_id","parent_message_id") REFERENCES "chat_message"("organization_id","tenant_id","thread_id","id") DEFERRABLE INITIALLY IMMEDIATE;
--> statement-breakpoint
ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_turn_fk" FOREIGN KEY ("organization_id","tenant_id","thread_id","turn_message_id") REFERENCES "chat_message"("organization_id","tenant_id","thread_id","id") DEFERRABLE INITIALLY IMMEDIATE;
--> statement-breakpoint
ALTER TABLE "chat_message_part" ADD CONSTRAINT "chat_message_part_FBudTaTR7Xcv_fkey" FOREIGN KEY ("organization_id","tenant_id","thread_id","message_id") REFERENCES "chat_message"("organization_id","tenant_id","thread_id","id") ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
--> statement-breakpoint
ALTER TABLE "chat_thread" ADD CONSTRAINT "chat_thread_current_leaf_fk" FOREIGN KEY ("organization_id","tenant_id","id","current_leaf_message_id") REFERENCES "chat_message"("organization_id","tenant_id","thread_id","id") DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "chat_tool_response" ADD CONSTRAINT "chat_tool_response_uc05DjAdWyKZ_fkey" FOREIGN KEY ("organization_id","tenant_id","thread_id","tool_part_id") REFERENCES "chat_message_part"("organization_id","tenant_id","thread_id","id") ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
--> statement-breakpoint
ALTER TABLE "chat_tool_response" ADD CONSTRAINT "chat_tool_response_result_fk" FOREIGN KEY ("organization_id","tenant_id","thread_id","result_message_id") REFERENCES "chat_message"("organization_id","tenant_id","thread_id","id") ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
--> statement-breakpoint
ALTER TABLE "account" ALTER CONSTRAINT "account_user_id_user_id_fkey" DEFERRABLE INITIALLY IMMEDIATE;
--> statement-breakpoint
ALTER TABLE "agent" ALTER CONSTRAINT "agent_organization_id_organization_id_fkey" DEFERRABLE INITIALLY IMMEDIATE;
--> statement-breakpoint
ALTER TABLE "agent_model" ALTER CONSTRAINT "agent_model_organization_id_organization_id_fkey" DEFERRABLE INITIALLY IMMEDIATE;
--> statement-breakpoint
ALTER TABLE "agent_model" ALTER CONSTRAINT "agent_model_agent_fk" DEFERRABLE INITIALLY IMMEDIATE;
--> statement-breakpoint
ALTER TABLE "api_key" ALTER CONSTRAINT "api_key_organization_id_organization_id_fkey" DEFERRABLE INITIALLY IMMEDIATE;
--> statement-breakpoint
ALTER TABLE "chat_message" ALTER CONSTRAINT "chat_message_GZHbGL4wY2dX_fkey" DEFERRABLE INITIALLY IMMEDIATE;
--> statement-breakpoint
ALTER TABLE "chat_message" ALTER CONSTRAINT "chat_message_author_user_fk" DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "chat_participant" ALTER CONSTRAINT "chat_participant_n4FMX5UgxTHV_fkey" DEFERRABLE INITIALLY IMMEDIATE;
--> statement-breakpoint
ALTER TABLE "chat_participant" ALTER CONSTRAINT "chat_participant_w4KZseuvg2k4_fkey" DEFERRABLE INITIALLY IMMEDIATE;
--> statement-breakpoint
ALTER TABLE "chat_thread" ALTER CONSTRAINT "chat_thread_BJfIblRVwD5t_fkey" DEFERRABLE INITIALLY IMMEDIATE;
--> statement-breakpoint
ALTER TABLE "chat_tool_response" ALTER CONSTRAINT "chat_tool_response_Q6o5kgeQZea1_fkey" DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "invitation" ALTER CONSTRAINT "invitation_organization_id_organization_id_fkey" DEFERRABLE INITIALLY IMMEDIATE;
--> statement-breakpoint
ALTER TABLE "invitation" ALTER CONSTRAINT "invitation_inviter_id_user_id_fkey" DEFERRABLE INITIALLY IMMEDIATE;
--> statement-breakpoint
ALTER TABLE "member" ALTER CONSTRAINT "member_organization_id_organization_id_fkey" DEFERRABLE INITIALLY IMMEDIATE;
--> statement-breakpoint
ALTER TABLE "member" ALTER CONSTRAINT "member_user_id_user_id_fkey" DEFERRABLE INITIALLY IMMEDIATE;
--> statement-breakpoint
ALTER TABLE "model_provider" ALTER CONSTRAINT "model_provider_organization_id_organization_id_fkey" DEFERRABLE INITIALLY IMMEDIATE;
--> statement-breakpoint
ALTER TABLE "organization_configuration" ALTER CONSTRAINT "organization_configuration_organization_id_organization_id_fkey" DEFERRABLE INITIALLY IMMEDIATE;
--> statement-breakpoint
ALTER TABLE "provider_model" ALTER CONSTRAINT "provider_model_organization_id_organization_id_fkey" DEFERRABLE INITIALLY IMMEDIATE;
--> statement-breakpoint
ALTER TABLE "provider_model" ALTER CONSTRAINT "provider_model_provider_fk" DEFERRABLE INITIALLY IMMEDIATE;
--> statement-breakpoint
ALTER TABLE "sandbox_provider" ALTER CONSTRAINT "sandbox_provider_organization_id_organization_id_fkey" DEFERRABLE INITIALLY IMMEDIATE;
--> statement-breakpoint
ALTER TABLE "session" ALTER CONSTRAINT "session_user_id_user_id_fkey" DEFERRABLE INITIALLY IMMEDIATE;
--> statement-breakpoint
ALTER TABLE "tenant" ALTER CONSTRAINT "tenant_organization_id_organization_id_fkey" DEFERRABLE INITIALLY IMMEDIATE;
--> statement-breakpoint
ALTER TABLE "tenant_user" ALTER CONSTRAINT "tenant_user_organization_id_tenant_id_fk" DEFERRABLE INITIALLY IMMEDIATE;
