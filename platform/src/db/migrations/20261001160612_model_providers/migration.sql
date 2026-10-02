CREATE TABLE "agent_model" (
	"id" uuid DEFAULT uuidv7(),
	"organization_id" uuid,
	"agent_id" uuid NOT NULL,
	"provider_model_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_model_pkey" PRIMARY KEY("organization_id","id"),
	CONSTRAINT "agent_model_position_check" CHECK ("position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "model_provider" (
	"id" uuid DEFAULT uuidv7(),
	"organization_id" uuid,
	"name" citext NOT NULL,
	"provider_type" text NOT NULL,
	"api" text NOT NULL,
	"base_url" text NOT NULL,
	"credentials" text,
	"lock_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_provider_pkey" PRIMARY KEY("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "provider_model" (
	"id" uuid DEFAULT uuidv7(),
	"organization_id" uuid,
	"model_provider_id" uuid NOT NULL,
	"model_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_model_pkey" PRIMARY KEY("organization_id","id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_model_assignment_uidx" ON "agent_model" ("organization_id","agent_id","provider_model_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_model_position_uidx" ON "agent_model" ("organization_id","agent_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "model_provider_organization_id_name_uidx" ON "model_provider" ("organization_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_model_provider_model_uidx" ON "provider_model" ("organization_id","model_provider_id","model_id");--> statement-breakpoint
ALTER TABLE "agent_model" ADD CONSTRAINT "agent_model_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "agent_model" ADD CONSTRAINT "agent_model_agent_fk" FOREIGN KEY ("organization_id","agent_id") REFERENCES "agent"("organization_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "agent_model" ADD CONSTRAINT "agent_model_provider_model_fk" FOREIGN KEY ("organization_id","provider_model_id") REFERENCES "provider_model"("organization_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "model_provider" ADD CONSTRAINT "model_provider_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "provider_model" ADD CONSTRAINT "provider_model_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "provider_model" ADD CONSTRAINT "provider_model_provider_fk" FOREIGN KEY ("organization_id","model_provider_id") REFERENCES "model_provider"("organization_id","id") ON DELETE CASCADE;