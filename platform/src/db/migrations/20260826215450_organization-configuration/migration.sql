CREATE TABLE "organization_configuration" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"organization_id" uuid NOT NULL,
	"lock_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP TABLE "config_session";--> statement-breakpoint
ALTER TABLE "config" DROP COLUMN "updated_by";--> statement-breakpoint
CREATE UNIQUE INDEX "organization_configuration_organization_id_uidx" ON "organization_configuration" ("organization_id");--> statement-breakpoint
ALTER TABLE "organization_configuration" ADD CONSTRAINT "organization_configuration_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;
