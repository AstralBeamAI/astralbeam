CREATE TYPE "file_upload_status" AS ENUM('preparing', 'pending', 'completing', 'completed', 'cancelled');--> statement-breakpoint
CREATE TABLE "file_upload" (
	"organization_id" uuid,
	"tenant_id" uuid,
	"id" uuid DEFAULT uuidv7(),
	"tenant_user_id" uuid NOT NULL,
	"prepare_key" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"upload_id" text,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" text NOT NULL,
	"status" "file_upload_status" DEFAULT 'preparing'::"file_upload_status" NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '24 hours' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_upload_pkey" PRIMARY KEY("organization_id","tenant_id","id"),
	CONSTRAINT "file_upload_size_check" CHECK ("byte_size" > 0 and "byte_size" <= 20971520),
	CONSTRAINT "file_upload_sha256_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "file_upload_prepare_key_uidx" ON "file_upload" ("organization_id","tenant_id","tenant_user_id","prepare_key");--> statement-breakpoint
CREATE UNIQUE INDEX "file_upload_object_key_uidx" ON "file_upload" ("object_key");--> statement-breakpoint
CREATE UNIQUE INDEX "file_upload_file_uidx" ON "file_upload" ("organization_id","file_id");--> statement-breakpoint
CREATE INDEX "file_upload_expiry_idx" ON "file_upload" ("expires_at");--> statement-breakpoint
ALTER TABLE "file_upload" ADD CONSTRAINT "file_upload_WIsVRnQhOj30_fkey" FOREIGN KEY ("organization_id","tenant_id","tenant_user_id") REFERENCES "tenant_user"("organization_id","tenant_id","id") ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "file_upload" ADD CONSTRAINT "file_upload_vLwZKEpI8Tg6_fkey" FOREIGN KEY ("organization_id","file_id") REFERENCES "file_object"("organization_id","id") ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;