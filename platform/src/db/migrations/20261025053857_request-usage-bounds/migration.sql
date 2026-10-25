ALTER TABLE "chat_message" ADD COLUMN "first_request_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "chat_message" ADD COLUMN "last_request_at" timestamp with time zone;--> statement-breakpoint
UPDATE "chat_message" SET
  (first_request_at, last_request_at) = (
    SELECT min((request->>'startedAt')::timestamptz), max((request->>'startedAt')::timestamptz)
    FROM jsonb_array_elements(request_accounting->'requests') request
  ), updated_at = now()
WHERE request_accounting IS NOT NULL;--> statement-breakpoint
CREATE INDEX "chat_message_user_request_usage_idx" ON "chat_message" ("organization_id","tenant_id",("metadata"->'provenance'->>'initiatorTenantUserId'),"last_request_at","first_request_at") WHERE "role" = 'assistant';
