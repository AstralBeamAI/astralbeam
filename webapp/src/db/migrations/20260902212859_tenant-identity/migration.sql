CREATE TABLE "tenant" (
	"organization_id" uuid,
	"id" uuid DEFAULT uuidv7(),
	"external_id" text NOT NULL,
	"name" text,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_pkey" PRIMARY KEY("organization_id","id"),
	CONSTRAINT "tenant_metadata_object_check" CHECK (jsonb_typeof("metadata") = 'object')
);
--> statement-breakpoint
CREATE TABLE "tenant_user" (
	"organization_id" uuid,
	"tenant_id" uuid,
	"id" uuid DEFAULT uuidv7(),
	"external_id" text NOT NULL,
	"name" text,
	"admin" boolean DEFAULT false NOT NULL,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_user_pkey" PRIMARY KEY("organization_id","tenant_id","id"),
	CONSTRAINT "tenant_user_metadata_object_check" CHECK (jsonb_typeof("metadata") = 'object')
);
--> statement-breakpoint
ALTER TABLE "organization_configuration" DROP CONSTRAINT "organization_configuration_default_agent_id_fk";--> statement-breakpoint
ALTER TABLE "agent" DROP CONSTRAINT "agent_organization_id_sandbox_provider_id_fk";--> statement-breakpoint
DROP INDEX "agent_organization_id_id_uidx";--> statement-breakpoint
DROP INDEX "sandbox_provider_organization_id_id_uidx";--> statement-breakpoint
ALTER TABLE "agent" DROP CONSTRAINT "agent_pkey";--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_pkey" PRIMARY KEY("organization_id","id");--> statement-breakpoint
ALTER TABLE "organization_configuration" DROP CONSTRAINT "organization_configuration_pkey";--> statement-breakpoint
ALTER TABLE "organization_configuration" ADD CONSTRAINT "organization_configuration_pkey" PRIMARY KEY("organization_id","id");--> statement-breakpoint
ALTER TABLE "sandbox_provider" DROP CONSTRAINT "sandbox_provider_pkey";--> statement-breakpoint
ALTER TABLE "sandbox_provider" ADD CONSTRAINT "sandbox_provider_pkey" PRIMARY KEY("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_organization_id_external_id_uidx" ON "tenant" ("organization_id","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_user_organization_id_tenant_id_external_id_uidx" ON "tenant_user" ("organization_id","tenant_id","external_id");--> statement-breakpoint
ALTER TABLE "tenant" ADD CONSTRAINT "tenant_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "tenant_user" ADD CONSTRAINT "tenant_user_organization_id_tenant_id_fk" FOREIGN KEY ("organization_id","tenant_id") REFERENCES "tenant"("organization_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_organization_id_sandbox_provider_id_fk" FOREIGN KEY ("organization_id","sandbox_provider_id") REFERENCES "sandbox_provider"("organization_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "organization_configuration" ADD CONSTRAINT "organization_configuration_default_agent_id_fk" FOREIGN KEY ("organization_id","default_agent_id") REFERENCES "agent"("organization_id","id") ON DELETE RESTRICT;
