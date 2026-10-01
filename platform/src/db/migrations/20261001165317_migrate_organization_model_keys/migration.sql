LOCK TABLE "organization_configuration" IN ACCESS EXCLUSIVE MODE;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM organization_configuration WHERE openai_api_key IS NOT NULL) THEN
    RAISE EXCEPTION 'Migrate stored organization model credentials through the application migration runner before removing their column';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "organization_configuration" DROP COLUMN "openai_api_key";
