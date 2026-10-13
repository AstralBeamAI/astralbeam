UPDATE "user" SET image = NULL, updated_at = now() WHERE image IS NOT NULL;--> statement-breakpoint
UPDATE organization SET logo = NULL, updated_at = now() WHERE logo IS NOT NULL;--> statement-breakpoint
DELETE FROM file_object;--> statement-breakpoint
ALTER TABLE "file_object" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "avatar_file_id" uuid;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "logo_file_id" uuid;--> statement-breakpoint
ALTER TABLE "file_object" DROP CONSTRAINT "file_object_pkey";--> statement-breakpoint
ALTER TABLE "file_object" ADD CONSTRAINT "file_object_pkey" PRIMARY KEY("organization_id","id");--> statement-breakpoint
ALTER TABLE "file_object" ADD CONSTRAINT "file_object_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_avatar_current_fk" FOREIGN KEY ("organization_id","avatar_file_id") REFERENCES "file_object"("organization_id","id") DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_logo_current_fk" FOREIGN KEY ("id","logo_file_id") REFERENCES "file_object"("organization_id","id") DEFERRABLE INITIALLY IMMEDIATE;