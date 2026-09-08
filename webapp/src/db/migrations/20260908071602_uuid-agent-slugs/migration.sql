ALTER TABLE "organization_configuration" DROP CONSTRAINT "organization_configuration_default_agent_id_fk";--> statement-breakpoint
ALTER TABLE "agent" DROP CONSTRAINT "agent_id_check";--> statement-breakpoint
ALTER TABLE "agent" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "agent" ALTER COLUMN "id" SET DATA TYPE uuid USING substring("id" from 7)::uuid;--> statement-breakpoint
ALTER TABLE "agent" ALTER COLUMN "id" SET DEFAULT uuidv7();--> statement-breakpoint
ALTER TABLE "organization_configuration" ALTER COLUMN "default_agent_id" SET DATA TYPE uuid USING substring("default_agent_id" from 7)::uuid;--> statement-breakpoint
ALTER TABLE "organization_configuration" ADD CONSTRAINT "organization_configuration_default_agent_id_fk" FOREIGN KEY ("organization_id","default_agent_id") REFERENCES "agent"("organization_id","id") ON DELETE RESTRICT;
