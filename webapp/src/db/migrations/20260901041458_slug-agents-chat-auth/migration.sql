CREATE TABLE "agent" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"organization_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"system_prompt" text NOT NULL,
	"sandbox_provider_id" uuid NOT NULL,
	"lock_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_slug_check" CHECK ("slug" ~ '^[0-9a-z]{1,63}$'),
	CONSTRAINT "agent_system_prompt_length_check" CHECK (char_length("system_prompt") between 1 and 32768)
);
--> statement-breakpoint
ALTER TABLE "api_key" ADD COLUMN "slug" text NOT NULL;
--> statement-breakpoint
DROP INDEX "api_key_key_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "api_key_key_idx" ON "api_key" ("key");--> statement-breakpoint
CREATE INDEX "agent_organization_id_sandbox_provider_id_idx" ON "agent" ("organization_id","sandbox_provider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_organization_id_slug_uidx" ON "agent" ("organization_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "api_key_organization_id_slug_uidx" ON "api_key" ("organization_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "sandbox_provider_organization_id_id_uidx" ON "sandbox_provider" ("organization_id","id");--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_organization_id_sandbox_provider_id_fk" FOREIGN KEY ("organization_id","sandbox_provider_id") REFERENCES "sandbox_provider"("organization_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_slug_check" CHECK ("slug" ~ '^[0-9a-z]{1,63}$');--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_slug_check" CHECK ("slug" ~ '^[0-9a-z]{1,63}$');
--> statement-breakpoint
DELETE FROM "config" WHERE "key" = 'chat_auth_secret';
