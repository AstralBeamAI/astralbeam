CREATE TABLE "chat_file" (
	"organization_id" uuid,
	"id" uuid DEFAULT uuidv7(),
	"tenant_id" uuid,
	"uploader_tenant_user_id" uuid NOT NULL,
	"file_object_id" uuid NOT NULL,
	"thread_id" uuid,
	"message_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_file_pkey" PRIMARY KEY("organization_id","tenant_id","id")
);
--> statement-breakpoint
CREATE INDEX "chat_file_organization_id_tenant_id_file_object_id_index" ON "chat_file" ("organization_id","tenant_id","file_object_id");--> statement-breakpoint
CREATE INDEX "chat_file_organization_id_tenant_id_thread_id_index" ON "chat_file" ("organization_id","tenant_id","thread_id");--> statement-breakpoint
ALTER TABLE "chat_file" ADD CONSTRAINT "chat_file_AZUvX99aJOIw_fkey" FOREIGN KEY ("organization_id","tenant_id","uploader_tenant_user_id") REFERENCES "tenant_user"("organization_id","tenant_id","id") ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "chat_file" ADD CONSTRAINT "chat_file_sL6EXBw9Dk36_fkey" FOREIGN KEY ("organization_id","tenant_id","thread_id","message_id") REFERENCES "chat_message"("organization_id","tenant_id","thread_id","id") ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "chat_file" ADD CONSTRAINT "chat_file_iIJ0QiZ3piHd_fkey" FOREIGN KEY ("organization_id","file_object_id") REFERENCES "file_object"("organization_id","id") ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;