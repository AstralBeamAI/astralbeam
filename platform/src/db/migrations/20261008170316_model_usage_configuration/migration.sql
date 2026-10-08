ALTER TABLE "config" ADD COLUMN "json_value" jsonb;--> statement-breakpoint
ALTER TABLE "provider_model" ADD COLUMN "usage_configuration" jsonb;--> statement-breakpoint
ALTER TABLE "config" ALTER COLUMN "value" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "config" ADD CONSTRAINT "config_value_check" CHECK (num_nonnulls("value", "json_value") = 1);