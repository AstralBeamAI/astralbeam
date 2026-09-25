DROP INDEX "account_issuer_account_id_uidx";--> statement-breakpoint
ALTER TABLE "account" DROP COLUMN "issuer";--> statement-breakpoint
CREATE UNIQUE INDEX "account_provider_id_account_id_uidx" ON "account" ("provider_id","account_id");