ALTER TABLE "organization_configuration" ADD COLUMN "openai_api_key" text;--> statement-breakpoint
-- The deployment no longer has a model key of its own, so the stored row is dropped here instead
-- of being left behind as a secret nothing reads.
DELETE FROM "config" WHERE "key" = 'openai_api_key';
