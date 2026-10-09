CREATE TYPE "file_upload_status" AS ENUM('preparing', 'pending', 'completing', 'completed', 'cancelled');--> statement-breakpoint
CREATE TABLE "file_upload" (
	"organization_id" uuid,
	"tenant_id" uuid,
	"id" uuid DEFAULT uuidv7(),
	"tenant_user_id" uuid NOT NULL,
	"prepare_key" uuid,
	"object_key" text NOT NULL,
	"upload_id" text,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" text NOT NULL,
	"status" "file_upload_status" DEFAULT 'preparing'::"file_upload_status" NOT NULL,
	"file_id" uuid,
	"expires_at" timestamp with time zone DEFAULT now() + interval '24 hours' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_upload_pkey" PRIMARY KEY("organization_id","tenant_id","id"),
	CONSTRAINT "file_upload_size_check" CHECK ("byte_size" > 0 and "byte_size" <= 20971520),
	CONSTRAINT "file_upload_sha256_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "multipart_deletion" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"object_key" text NOT NULL,
	"upload_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"retry_at" timestamp with time zone DEFAULT now() + interval '1 minute' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "file_upload_prepare_key_uidx" ON "file_upload" ("organization_id","tenant_id","tenant_user_id","prepare_key");--> statement-breakpoint
CREATE UNIQUE INDEX "file_upload_object_key_uidx" ON "file_upload" ("object_key");--> statement-breakpoint
CREATE UNIQUE INDEX "file_upload_file_uidx" ON "file_upload" ("file_id");--> statement-breakpoint
CREATE INDEX "file_upload_expiry_idx" ON "file_upload" ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "multipart_deletion_key_uidx" ON "multipart_deletion" ("object_key");--> statement-breakpoint
CREATE INDEX "multipart_deletion_retry_idx" ON "multipart_deletion" ("retry_at");--> statement-breakpoint
ALTER TABLE "file_upload" ADD CONSTRAINT "file_upload_WIsVRnQhOj30_fkey" FOREIGN KEY ("organization_id","tenant_id","tenant_user_id") REFERENCES "tenant_user"("organization_id","tenant_id","id") ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "file_upload" ADD CONSTRAINT "file_upload_file_id_file_object_id_fkey" FOREIGN KEY ("file_id") REFERENCES "file_object"("id") ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE;
--> statement-breakpoint
CREATE FUNCTION release_file_upload() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO multipart_deletion(object_key, upload_id) VALUES (OLD.object_key, OLD.upload_id)
    ON CONFLICT (object_key) DO NOTHING;
  DELETE FROM file_object WHERE id = OLD.file_id
    AND NOT EXISTS (SELECT 1 FROM chat_file WHERE id = OLD.file_id);
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER file_upload_cleanup AFTER DELETE ON file_upload FOR EACH ROW EXECUTE FUNCTION release_file_upload();
