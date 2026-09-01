DO $$
DECLARE
	organization_row record;
	base_slug text;
	candidate_slug text;
	attempt integer;
BEGIN
	FOR organization_row IN
		SELECT "id", "slug"
		FROM "organization"
		WHERE "slug" !~ '^[0-9a-z]{1,63}$'
		ORDER BY "id"
	LOOP
		base_slug := left(regexp_replace(lower(organization_row."slug"), '[^0-9a-z]', '', 'g'), 63);
		candidate_slug := base_slug;
		attempt := 0;

		IF candidate_slug = '' OR EXISTS (
			SELECT 1
			FROM "organization"
			WHERE "slug" = candidate_slug AND "id" <> organization_row."id"
		) THEN
			base_slug := left(COALESCE(NULLIF(base_slug, ''), 'org'), 58);
			LOOP
				candidate_slug := base_slug || substr(md5(organization_row."id"::text || ':' || attempt::text), 1, 5);
				EXIT WHEN NOT EXISTS (
					SELECT 1
					FROM "organization"
					WHERE "slug" = candidate_slug AND "id" <> organization_row."id"
				);
				attempt := attempt + 1;
				IF attempt > 10000 THEN
					RAISE EXCEPTION 'Unable to allocate a unique organization slug';
				END IF;
			END LOOP;
		END IF;

		UPDATE "organization"
		SET "slug" = candidate_slug, "updated_at" = now()
		WHERE "id" = organization_row."id";
	END LOOP;
END
$$;
--> statement-breakpoint
CREATE TABLE "agent" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"organization_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"system_prompt" text NOT NULL,
	"sandbox_provider_id" uuid NOT NULL,
	"lock_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_slug_check" CHECK ("slug" ~ '^[0-9a-z]{1,63}$'),
	CONSTRAINT "agent_system_prompt_length_check" CHECK (char_length("system_prompt") between 1 and 32768)
);
--> statement-breakpoint
ALTER TABLE "api_key" ADD COLUMN "slug" text NOT NULL;
--> statement-breakpoint
DROP INDEX "api_key_key_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "api_key_key_idx" ON "api_key" ("key");--> statement-breakpoint
CREATE INDEX "agent_organization_id_sandbox_provider_id_idx" ON "agent" ("organization_id","sandbox_provider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_organization_id_slug_uidx" ON "agent" ("organization_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "api_key_organization_id_slug_uidx" ON "api_key" ("organization_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "sandbox_provider_organization_id_id_uidx" ON "sandbox_provider" ("organization_id","id");--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_organization_id_sandbox_provider_id_fk" FOREIGN KEY ("organization_id","sandbox_provider_id") REFERENCES "sandbox_provider"("organization_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_slug_check" CHECK ("slug" ~ '^[0-9a-z]{1,63}$');--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_slug_check" CHECK ("slug" ~ '^[0-9a-z]{1,63}$');
--> statement-breakpoint
CREATE FUNCTION "set_api_key_slug_from_prefix"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NEW."prefix" IS NULL OR NEW."prefix" !~ '^abo_[0-9a-z]{1,63}_$' THEN
		RAISE EXCEPTION 'API key creation requires a valid slug-bearing prefix'
			USING ERRCODE = '23514';
	END IF;

	NEW."slug" := substring(NEW."prefix" FROM '^abo_([0-9a-z]{1,63})_$');
	RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER "api_key_slug_from_prefix"
	BEFORE INSERT ON "api_key"
	FOR EACH ROW
	EXECUTE FUNCTION "set_api_key_slug_from_prefix"();
--> statement-breakpoint
DELETE FROM "config" WHERE "key" = 'chat_auth_secret';
