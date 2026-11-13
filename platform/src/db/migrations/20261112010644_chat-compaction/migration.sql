CREATE TABLE "chat_compaction" (
	"organization_id" uuid,
	"id" uuid DEFAULT uuidv7(),
	"tenant_id" uuid,
	"thread_id" uuid NOT NULL,
	"covered_through_message_id" uuid NOT NULL,
	"compatibility_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"usage" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_compaction_pkey" PRIMARY KEY("organization_id","tenant_id","id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "chat_compaction_anchor_uidx" ON "chat_compaction" ("organization_id","tenant_id","thread_id","covered_through_message_id","compatibility_key",("payload"->>'kind'));--> statement-breakpoint
ALTER TABLE "chat_compaction" ADD CONSTRAINT "chat_compaction_VY6tWU9mHCj3_fkey" FOREIGN KEY ("organization_id","tenant_id","thread_id") REFERENCES "chat_thread"("organization_id","tenant_id","id") ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "chat_compaction" ADD CONSTRAINT "chat_compaction_kC5braHpQRpe_fkey" FOREIGN KEY ("organization_id","tenant_id","thread_id","covered_through_message_id") REFERENCES "chat_message"("organization_id","tenant_id","thread_id","id") ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
