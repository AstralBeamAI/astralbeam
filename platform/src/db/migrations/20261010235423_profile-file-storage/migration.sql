UPDATE "user" SET image = NULL, updated_at = now() WHERE image IS NOT NULL;--> statement-breakpoint
UPDATE organization SET logo = NULL, updated_at = now() WHERE logo IS NOT NULL;--> statement-breakpoint
ALTER TABLE "file_object" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "file_object" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "logo_file_id" uuid;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "logo_import_generation" uuid;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "logo_import_source_url" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "avatar_file_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "file_object_user_id_uidx" ON "file_object" ("user_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "file_object_organization_id_uidx" ON "file_object" ("organization_id","id");--> statement-breakpoint
ALTER TABLE "file_object" ADD CONSTRAINT "file_object_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "file_object" ADD CONSTRAINT "file_object_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_logo_current_fk" FOREIGN KEY ("id","logo_file_id") REFERENCES "file_object"("organization_id","id") DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_avatar_current_fk" FOREIGN KEY ("id","avatar_file_id") REFERENCES "file_object"("user_id","id") DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "file_object" ADD CONSTRAINT "file_object_profile_owner_check" CHECK ("user_id" is null or "organization_id" is null);--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_logo_url_check" CHECK ("logo" is not distinct from '/api/files/organizations/' || "id" || '/logos/' || "logo_file_id");--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_avatar_url_check" CHECK ("image" is not distinct from '/api/files/avatars/' || "avatar_file_id");