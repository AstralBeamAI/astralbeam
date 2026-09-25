CREATE TABLE "sandbox_provider" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"organization_id" uuid NOT NULL,
	"name" citext NOT NULL,
	"provider_type" text NOT NULL,
	"options" jsonb NOT NULL,
	"credentials" text,
	"last_test" jsonb,
	"lock_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "sandbox_provider_organization_id_name_uidx" ON "sandbox_provider" ("organization_id","name");--> statement-breakpoint
ALTER TABLE "sandbox_provider" ADD CONSTRAINT "sandbox_provider_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;