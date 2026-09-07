ALTER TABLE "organization_configuration" DROP CONSTRAINT "organization_configuration_default_agent_id_fk";--> statement-breakpoint
ALTER TABLE "agent" DROP CONSTRAINT "agent_slug_check";--> statement-breakpoint
DROP INDEX "agent_organization_id_slug_uidx";--> statement-breakpoint
ALTER TABLE "agent" DROP COLUMN "slug";--> statement-breakpoint
ALTER TABLE "agent" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "agent" ALTER COLUMN "id" SET DATA TYPE text USING 'agent_' || "id"::text;--> statement-breakpoint
ALTER TABLE "agent" ALTER COLUMN "id" SET DEFAULT 'agent_' || uuidv7();--> statement-breakpoint
ALTER TABLE "agent" ALTER COLUMN "name" SET DATA TYPE citext USING "name"::citext;--> statement-breakpoint
ALTER TABLE "organization_configuration" ALTER COLUMN "default_agent_id" SET DATA TYPE text USING 'agent_' || "default_agent_id"::text;--> statement-breakpoint
ALTER TABLE "organization_configuration" ADD CONSTRAINT "organization_configuration_default_agent_id_fk" FOREIGN KEY ("organization_id","default_agent_id") REFERENCES "agent"("organization_id","id") ON DELETE RESTRICT;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_organization_id_name_uidx" ON "agent" ("organization_id","name");--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_id_check" CHECK ("id" ~ '^agent_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$');
