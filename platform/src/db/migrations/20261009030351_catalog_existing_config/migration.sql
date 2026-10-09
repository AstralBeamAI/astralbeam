ALTER TABLE "config" DROP CONSTRAINT "config_value_check";--> statement-breakpoint
-- The old catalog snapshot is rebuildable. Setup queues the v2 initialization after migration.
DELETE FROM "config" WHERE "key" = 'model_price_catalog' AND "value" IS NULL;--> statement-breakpoint
ALTER TABLE "config" DROP COLUMN "json_value";--> statement-breakpoint
ALTER TABLE "config" ALTER COLUMN "value" SET NOT NULL;
