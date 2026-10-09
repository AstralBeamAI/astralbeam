CREATE TABLE "chat_file" (
	"organization_id" uuid,
	"tenant_id" uuid,
	"thread_id" uuid,
	"id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_file_pkey" PRIMARY KEY("organization_id","tenant_id","thread_id","id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "chat_file_object_uidx" ON "chat_file" ("id");--> statement-breakpoint
ALTER TABLE "chat_file" ADD CONSTRAINT "chat_file_XTbF6HP2uYtW_fkey" FOREIGN KEY ("organization_id","tenant_id","thread_id") REFERENCES "chat_thread"("organization_id","tenant_id","id") ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "chat_file" ADD CONSTRAINT "chat_file_id_file_object_id_fkey" FOREIGN KEY ("id") REFERENCES "file_object"("id") ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION release_profile_file() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM file_object WHERE id = OLD.id
    AND NOT EXISTS (SELECT 1 FROM user_avatar WHERE id = OLD.id)
    AND NOT EXISTS (SELECT 1 FROM organization_logo WHERE id = OLD.id)
    AND NOT EXISTS (SELECT 1 FROM chat_file WHERE id = OLD.id);
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER chat_file_release AFTER DELETE ON chat_file FOR EACH ROW EXECUTE FUNCTION release_profile_file();
