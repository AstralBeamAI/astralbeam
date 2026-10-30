ALTER TABLE "chat_message" ADD COLUMN "request_accounting" jsonb;--> statement-breakpoint
ALTER TABLE "provider_model" ADD COLUMN "pricing_history" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
UPDATE provider_model SET pricing_history = jsonb_build_array(jsonb_build_object(
  'id', uuidv7()::text,
  'effectiveFrom', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'rates', jsonb_build_object('currency', configuration->'currency', 'pricingSource', configuration->'pricingSource', 'prices', configuration->'prices', 'contextTiers', configuration->'contextTiers')
)) WHERE configuration->'pricingSource'->>'kind' = 'manual';
