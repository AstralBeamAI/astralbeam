ALTER TABLE "api_key" DROP CONSTRAINT "api_key_slug_check";--> statement-breakpoint
DROP INDEX "api_key_organization_id_slug_uidx";--> statement-breakpoint
ALTER TABLE "api_key" DROP COLUMN "slug";