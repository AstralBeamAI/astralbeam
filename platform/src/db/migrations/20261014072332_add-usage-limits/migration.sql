CREATE TYPE "usage_limit_metric" AS ENUM('tokens', 'spend');--> statement-breakpoint
CREATE TYPE "usage_limit_scope" AS ENUM('global', 'tenant', 'tenant_user', 'thread');--> statement-breakpoint
CREATE TYPE "usage_limit_window_type" AS ENUM('fixed', 'rolling');--> statement-breakpoint
CREATE TYPE "usage_limit_window_unit" AS ENUM('minute', 'hour', 'day', 'week', 'month');--> statement-breakpoint
CREATE TABLE "usage_limit" (
	"organization_id" uuid,
	"id" uuid DEFAULT uuidv7(),
	"name" text NOT NULL,
	"enabled" boolean NOT NULL,
	"applies_by_default" boolean NOT NULL,
	"scope" "usage_limit_scope" NOT NULL,
	"metric" "usage_limit_metric" NOT NULL,
	"amount" numeric NOT NULL,
	"window_type" "usage_limit_window_type" NOT NULL,
	"window_count" integer NOT NULL,
	"window_unit" "usage_limit_window_unit" NOT NULL,
	"time_zone" text,
	"lock_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_limit_pkey" PRIMARY KEY("organization_id","id"),
	CONSTRAINT "usage_limit_name_length_check" CHECK (char_length("name") between 1 and 100),
	CONSTRAINT "usage_limit_amount_check" CHECK ("amount" > 0 and ("metric" = 'spend' or "amount" = trunc("amount"))),
	CONSTRAINT "usage_limit_window_count_check" CHECK ("window_count" > 0),
	CONSTRAINT "usage_limit_time_zone_check" CHECK (("window_type" = 'fixed') = ("time_zone" is not null)),
	CONSTRAINT "usage_limit_global_default_check" CHECK ("scope" <> 'global' or "applies_by_default")
);
--> statement-breakpoint
ALTER TABLE "usage_limit" ADD CONSTRAINT "usage_limit_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;