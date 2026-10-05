CREATE TYPE "chat_message_part_execution_location" AS ENUM('server_api', 'sandbox', 'browser');--> statement-breakpoint
CREATE TYPE "chat_message_role" AS ENUM('user', 'assistant', 'tool');--> statement-breakpoint
CREATE TYPE "chat_message_state" AS ENUM('draft', 'complete', 'interrupted');--> statement-breakpoint
CREATE TYPE "chat_message_turn_state" AS ENUM('running', 'waiting', 'completed', 'interrupted');--> statement-breakpoint
CREATE TYPE "chat_participant_role" AS ENUM('viewer', 'member', 'manager');--> statement-breakpoint
CREATE TABLE "chat_message" (
	"organization_id" uuid,
	"tenant_id" uuid,
	"id" uuid DEFAULT uuidv7(),
	"thread_id" uuid NOT NULL,
	"parent_message_id" uuid,
	"turn_message_id" uuid,
	"author_tenant_user_id" uuid,
	"role" "chat_message_role" NOT NULL,
	"state" "chat_message_state" NOT NULL,
	"metadata" jsonb NOT NULL,
	"turn_state" "chat_message_turn_state",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_message_pkey" PRIMARY KEY("organization_id","tenant_id","id"),
	CONSTRAINT "chat_message_role_check" CHECK ((
    ("role" = 'user' and "state" = 'complete' and "author_tenant_user_id" is not null and "turn_message_id" is null and "turn_state" is not null)
    or ("role" in ('assistant', 'tool') and "turn_message_id" is not null and "turn_state" is null)
  ) and ("role" = 'assistant' or "state" = 'complete') and ("role" <> 'assistant' or "author_tenant_user_id" is null)),
	CONSTRAINT "chat_message_ancestry_check" CHECK ("parent_message_id" is distinct from "id" and "turn_message_id" is distinct from "id")
);
--> statement-breakpoint
CREATE TABLE "chat_message_part" (
	"organization_id" uuid,
	"tenant_id" uuid,
	"id" uuid DEFAULT uuidv7(),
	"thread_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"execution_location" "chat_message_part_execution_location",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_message_part_pkey" PRIMARY KEY("organization_id","tenant_id","id"),
	CONSTRAINT "chat_message_part_position_check" CHECK ("position" >= 0),
	CONSTRAINT "chat_message_part_location_check" CHECK (("payload"->>'type' = 'tool-call') = ("execution_location" is not null))
);
--> statement-breakpoint
CREATE TABLE "chat_participant" (
	"organization_id" uuid,
	"tenant_id" uuid,
	"id" uuid DEFAULT uuidv7(),
	"thread_id" uuid NOT NULL,
	"tenant_user_id" uuid NOT NULL,
	"role" "chat_participant_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_participant_pkey" PRIMARY KEY("organization_id","tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "chat_thread" (
	"organization_id" uuid,
	"tenant_id" uuid,
	"id" uuid DEFAULT uuidv7(),
	"agent_id" uuid,
	"title" text DEFAULT '' NOT NULL,
	"current_leaf_message_id" uuid,
	"lock_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_thread_pkey" PRIMARY KEY("organization_id","tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "chat_tool_response" (
	"organization_id" uuid,
	"tenant_id" uuid,
	"id" uuid DEFAULT uuidv7(),
	"thread_id" uuid NOT NULL,
	"tool_part_id" uuid NOT NULL,
	"tenant_user_id" uuid,
	"client_id" uuid,
	"result_message_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_tool_response_pkey" PRIMARY KEY("organization_id","tenant_id","id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "chat_message_thread_id_uidx" ON "chat_message" ("organization_id","tenant_id","thread_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_message_turn_draft_uidx" ON "chat_message" ("organization_id","tenant_id","thread_id","turn_message_id") WHERE "state" = 'draft';--> statement-breakpoint
CREATE INDEX "chat_message_parent_idx" ON "chat_message" ("organization_id","tenant_id","thread_id","parent_message_id");--> statement-breakpoint
CREATE INDEX "chat_message_turn_idx" ON "chat_message" ("organization_id","tenant_id","thread_id","turn_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_message_part_thread_id_uidx" ON "chat_message_part" ("organization_id","tenant_id","thread_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_message_part_position_uidx" ON "chat_message_part" ("organization_id","tenant_id","message_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_participant_user_uidx" ON "chat_participant" ("organization_id","tenant_id","thread_id","tenant_user_id");--> statement-breakpoint
CREATE INDEX "chat_participant_access_idx" ON "chat_participant" ("organization_id","tenant_id","tenant_user_id","thread_id");--> statement-breakpoint
CREATE INDEX "chat_thread_activity_idx" ON "chat_thread" ("organization_id","tenant_id","updated_at","id");--> statement-breakpoint
CREATE INDEX "chat_tool_response_part_idx" ON "chat_tool_response" ("organization_id","tenant_id","thread_id","tool_part_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_tool_response_result_uidx" ON "chat_tool_response" ("organization_id","tenant_id","result_message_id") WHERE "result_message_id" is not null;--> statement-breakpoint
ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_GZHbGL4wY2dX_fkey" FOREIGN KEY ("organization_id","tenant_id","thread_id") REFERENCES "chat_thread"("organization_id","tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_parent_fk" FOREIGN KEY ("organization_id","tenant_id","thread_id","parent_message_id") REFERENCES "chat_message"("organization_id","tenant_id","thread_id","id");--> statement-breakpoint
ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_turn_fk" FOREIGN KEY ("organization_id","tenant_id","thread_id","turn_message_id") REFERENCES "chat_message"("organization_id","tenant_id","thread_id","id");--> statement-breakpoint
ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_author_user_fk" FOREIGN KEY ("organization_id","tenant_id","author_tenant_user_id") REFERENCES "tenant_user"("organization_id","tenant_id","id") DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "chat_message_part" ADD CONSTRAINT "chat_message_part_FBudTaTR7Xcv_fkey" FOREIGN KEY ("organization_id","tenant_id","thread_id","message_id") REFERENCES "chat_message"("organization_id","tenant_id","thread_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "chat_participant" ADD CONSTRAINT "chat_participant_n4FMX5UgxTHV_fkey" FOREIGN KEY ("organization_id","tenant_id","thread_id") REFERENCES "chat_thread"("organization_id","tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "chat_participant" ADD CONSTRAINT "chat_participant_w4KZseuvg2k4_fkey" FOREIGN KEY ("organization_id","tenant_id","tenant_user_id") REFERENCES "tenant_user"("organization_id","tenant_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "chat_thread" ADD CONSTRAINT "chat_thread_BJfIblRVwD5t_fkey" FOREIGN KEY ("organization_id","tenant_id") REFERENCES "tenant"("organization_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "chat_thread" ADD CONSTRAINT "chat_thread_agent_fk" FOREIGN KEY ("organization_id","agent_id") REFERENCES "agent"("organization_id","id");--> statement-breakpoint
ALTER TABLE "chat_thread" ADD CONSTRAINT "chat_thread_current_leaf_fk" FOREIGN KEY ("organization_id","tenant_id","id","current_leaf_message_id") REFERENCES "chat_message"("organization_id","tenant_id","thread_id","id");--> statement-breakpoint
ALTER TABLE "chat_tool_response" ADD CONSTRAINT "chat_tool_response_uc05DjAdWyKZ_fkey" FOREIGN KEY ("organization_id","tenant_id","thread_id","tool_part_id") REFERENCES "chat_message_part"("organization_id","tenant_id","thread_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "chat_tool_response" ADD CONSTRAINT "chat_tool_response_result_fk" FOREIGN KEY ("organization_id","tenant_id","thread_id","result_message_id") REFERENCES "chat_message"("organization_id","tenant_id","thread_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "chat_tool_response" ADD CONSTRAINT "chat_tool_response_Q6o5kgeQZea1_fkey" FOREIGN KEY ("organization_id","tenant_id","tenant_user_id") REFERENCES "tenant_user"("organization_id","tenant_id","id") DEFERRABLE INITIALLY DEFERRED;
