CREATE TABLE "sandbox_resource" (
	"organization_id" uuid,
	"id" uuid DEFAULT uuidv7(),
	"owner_id" uuid NOT NULL,
	"provider_sandbox_id" text NOT NULL,
	"configuration" text NOT NULL,
	"settled" boolean DEFAULT false NOT NULL,
	"retired_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sandbox_resource_pkey" PRIMARY KEY("organization_id","id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "sandbox_resource_provider_id_uidx" ON "sandbox_resource" ("organization_id","provider_sandbox_id");--> statement-breakpoint
CREATE INDEX "sandbox_resource_expires_at_idx" ON "sandbox_resource" ("expires_at");--> statement-breakpoint
CREATE INDEX "sandbox_resource_owner_id_idx" ON "sandbox_resource" ("owner_id");--> statement-breakpoint
ALTER TABLE "sandbox_resource" ADD CONSTRAINT "sandbox_resource_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") DEFERRABLE INITIALLY IMMEDIATE;
