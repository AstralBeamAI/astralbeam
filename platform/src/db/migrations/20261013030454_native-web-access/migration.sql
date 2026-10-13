ALTER TYPE "chat_message_part_execution_location" ADD VALUE 'provider';--> statement-breakpoint
ALTER TABLE "agent" ADD COLUMN "web_access_enabled" boolean DEFAULT false NOT NULL;