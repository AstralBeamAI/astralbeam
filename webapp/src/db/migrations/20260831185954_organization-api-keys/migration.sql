CREATE TABLE "api_key" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"config_id" text DEFAULT 'organization' NOT NULL,
	"name" text NOT NULL,
	"start" text,
	"organization_id" uuid NOT NULL,
	"prefix" text,
	"key" text NOT NULL,
	"refill_interval" integer,
	"refill_amount" integer,
	"last_refill_at" timestamp with time zone,
	"enabled" boolean DEFAULT true NOT NULL,
	"rate_limit_enabled" boolean DEFAULT true NOT NULL,
	"rate_limit_time_window" integer DEFAULT 86400000 NOT NULL,
	"rate_limit_max" integer DEFAULT 10 NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"remaining" integer,
	"last_request" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"permissions" text,
	"metadata" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "api_key_config_id_idx" ON "api_key" ("config_id");--> statement-breakpoint
CREATE INDEX "api_key_organization_id_idx" ON "api_key" ("organization_id");--> statement-breakpoint
CREATE INDEX "api_key_key_idx" ON "api_key" ("key");--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;