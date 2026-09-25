CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX "tenant_name_trgm_idx" ON "tenant" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "tenant_external_id_trgm_idx" ON "tenant" USING gin ("external_id" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "tenant_user_name_trgm_idx" ON "tenant_user" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "tenant_user_external_id_trgm_idx" ON "tenant_user" USING gin ("external_id" gin_trgm_ops);
