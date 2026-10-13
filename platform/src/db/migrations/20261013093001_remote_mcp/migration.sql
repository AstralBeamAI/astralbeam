CREATE TYPE "mcp_connection_auth_state" AS ENUM('disconnected', 'connected', 'reauthorization_required', 'refresh_uncertain');--> statement-breakpoint
CREATE TYPE "mcp_oauth_attempt_status" AS ENUM('created', 'authorizing', 'exchanging', 'awaiting_completion', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "mcp_oauth_client_mechanism" AS ENUM('pre_registered', 'cimd', 'dcr');--> statement-breakpoint
CREATE TYPE "mcp_server_connection_scope" AS ENUM('organization', 'tenant', 'tenant_user');--> statement-breakpoint
CREATE TYPE "tenant_mcp_connection_auth_state" AS ENUM('disconnected', 'connected', 'reauthorization_required', 'refresh_uncertain');--> statement-breakpoint
CREATE TYPE "tenant_mcp_oauth_attempt_status" AS ENUM('created', 'authorizing', 'exchanging', 'awaiting_completion', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "tenant_mcp_oauth_client_mechanism" AS ENUM('pre_registered', 'cimd', 'dcr');--> statement-breakpoint
CREATE TABLE "mcp_connection" (
	"id" uuid DEFAULT uuidv7(),
	"organization_id" uuid,
	"name" citext NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"auth_error_code" text,
	"server_auth_revision" integer NOT NULL,
	"credentials" text,
	"auth_generation" uuid DEFAULT gen_random_uuid() NOT NULL,
	"token_revision" integer DEFAULT 0 NOT NULL,
	"refresh_claim_id" uuid,
	"refresh_claim_expires_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"last_verified_at" timestamp with time zone,
	"verification_result" text,
	"granted_scopes" jsonb DEFAULT '[]' NOT NULL,
	"lock_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"server_id" uuid NOT NULL,
	"oauth_client_id" uuid,
	"auth_state" "mcp_connection_auth_state" DEFAULT 'disconnected'::"mcp_connection_auth_state" NOT NULL,
	CONSTRAINT "mcp_connection_pkey" PRIMARY KEY("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "mcp_oauth_attempt" (
	"id" uuid DEFAULT uuidv7(),
	"organization_id" uuid,
	"connection_id" uuid NOT NULL,
	"actor" jsonb NOT NULL,
	"state_hash" text NOT NULL,
	"browser_binding_hash" text,
	"expected_generation" uuid NOT NULL,
	"server_auth_revision" integer NOT NULL,
	"payload" text,
	"expires_at" timestamp with time zone NOT NULL,
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "mcp_oauth_attempt_status" DEFAULT 'created'::"mcp_oauth_attempt_status" NOT NULL,
	CONSTRAINT "mcp_oauth_attempt_pkey" PRIMARY KEY("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "mcp_oauth_client" (
	"id" uuid DEFAULT uuidv7(),
	"organization_id" uuid,
	"server_auth_revision" integer NOT NULL,
	"issuer" text NOT NULL,
	"resource" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"client_metadata" jsonb NOT NULL,
	"credentials" text NOT NULL,
	"expires_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"server_id" uuid NOT NULL,
	"mechanism" "mcp_oauth_client_mechanism" NOT NULL,
	CONSTRAINT "mcp_oauth_client_pkey" PRIMARY KEY("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "mcp_server" (
	"id" uuid DEFAULT uuidv7(),
	"organization_id" uuid,
	"name" citext NOT NULL,
	"endpoint_url" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"auth_config" jsonb NOT NULL,
	"auth_revision" integer DEFAULT 0 NOT NULL,
	"lock_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"default_connection_scope" "mcp_server_connection_scope" DEFAULT 'tenant_user'::"mcp_server_connection_scope" NOT NULL,
	CONSTRAINT "mcp_server_pkey" PRIMARY KEY("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "tenant_mcp_connection" (
	"id" uuid DEFAULT uuidv7(),
	"organization_id" uuid,
	"name" citext NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"auth_error_code" text,
	"server_auth_revision" integer NOT NULL,
	"credentials" text,
	"auth_generation" uuid DEFAULT gen_random_uuid() NOT NULL,
	"token_revision" integer DEFAULT 0 NOT NULL,
	"refresh_claim_id" uuid,
	"refresh_claim_expires_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"last_verified_at" timestamp with time zone,
	"verification_result" text,
	"granted_scopes" jsonb DEFAULT '[]' NOT NULL,
	"lock_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tenant_id" uuid,
	"tenant_user_id" uuid,
	"organization_server_id" uuid,
	"tenant_server_id" uuid,
	"organization_o_auth_client_id" uuid,
	"tenant_o_auth_client_id" uuid,
	"auth_state" "tenant_mcp_connection_auth_state" DEFAULT 'disconnected'::"tenant_mcp_connection_auth_state" NOT NULL,
	CONSTRAINT "tenant_mcp_connection_pkey" PRIMARY KEY("organization_id","tenant_id","id"),
	CONSTRAINT "tenant_mcp_connection_name_uidx" UNIQUE NULLS NOT DISTINCT("organization_id","tenant_id","tenant_user_id","name"),
	CONSTRAINT "tenant_mcp_connection_server_check" CHECK (num_nonnulls("organization_server_id", "tenant_server_id") = 1),
	CONSTRAINT "tenant_mcp_connection_client_check" CHECK (num_nonnulls("organization_o_auth_client_id", "tenant_o_auth_client_id") <= 1)
);
--> statement-breakpoint
CREATE TABLE "tenant_mcp_oauth_attempt" (
	"id" uuid DEFAULT uuidv7(),
	"organization_id" uuid,
	"connection_id" uuid NOT NULL,
	"actor" jsonb NOT NULL,
	"state_hash" text NOT NULL,
	"browser_binding_hash" text,
	"expected_generation" uuid NOT NULL,
	"server_auth_revision" integer NOT NULL,
	"payload" text,
	"expires_at" timestamp with time zone NOT NULL,
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tenant_id" uuid,
	"status" "tenant_mcp_oauth_attempt_status" DEFAULT 'created'::"tenant_mcp_oauth_attempt_status" NOT NULL,
	CONSTRAINT "tenant_mcp_oauth_attempt_pkey" PRIMARY KEY("organization_id","tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "tenant_mcp_oauth_client" (
	"id" uuid DEFAULT uuidv7(),
	"organization_id" uuid,
	"server_auth_revision" integer NOT NULL,
	"issuer" text NOT NULL,
	"resource" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"client_metadata" jsonb NOT NULL,
	"credentials" text NOT NULL,
	"expires_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tenant_id" uuid,
	"tenant_user_id" uuid,
	"organization_server_id" uuid,
	"tenant_server_id" uuid,
	"mechanism" "tenant_mcp_oauth_client_mechanism" NOT NULL,
	CONSTRAINT "tenant_mcp_oauth_client_pkey" PRIMARY KEY("organization_id","tenant_id","id"),
	CONSTRAINT "tenant_mcp_oauth_client_server_check" CHECK (num_nonnulls("organization_server_id", "tenant_server_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "tenant_mcp_server" (
	"id" uuid DEFAULT uuidv7(),
	"organization_id" uuid,
	"name" citext NOT NULL,
	"endpoint_url" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"auth_config" jsonb NOT NULL,
	"auth_revision" integer DEFAULT 0 NOT NULL,
	"lock_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tenant_id" uuid,
	"tenant_user_id" uuid,
	CONSTRAINT "tenant_mcp_server_pkey" PRIMARY KEY("organization_id","tenant_id","id"),
	CONSTRAINT "tenant_mcp_server_name_uidx" UNIQUE NULLS NOT DISTINCT("organization_id","tenant_id","tenant_user_id","name")
);
--> statement-breakpoint
ALTER TABLE "organization_configuration" ADD COLUMN "allow_tenant_mcp_servers" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_configuration" ADD COLUMN "allow_tenant_user_mcp_servers" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_connection_name_uidx" ON "mcp_connection" ("organization_id","name");--> statement-breakpoint
CREATE INDEX "mcp_connection_server_idx" ON "mcp_connection" ("organization_id","server_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_oauth_attempt_state_uidx" ON "mcp_oauth_attempt" ("organization_id","state_hash");--> statement-breakpoint
CREATE INDEX "mcp_oauth_attempt_expiry_idx" ON "mcp_oauth_attempt" ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_oauth_client_active_uidx" ON "mcp_oauth_client" ("organization_id","server_id","server_auth_revision","issuer","resource") WHERE "active";--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_server_name_uidx" ON "mcp_server" ("organization_id","name");--> statement-breakpoint
CREATE INDEX "tenant_mcp_connection_server_idx" ON "tenant_mcp_connection" ("organization_id","tenant_id","tenant_server_id");--> statement-breakpoint
CREATE INDEX "tenant_mcp_connection_organization_server_idx" ON "tenant_mcp_connection" ("organization_id","organization_server_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_mcp_oauth_attempt_state_uidx" ON "tenant_mcp_oauth_attempt" ("organization_id","tenant_id","state_hash");--> statement-breakpoint
CREATE INDEX "tenant_mcp_oauth_attempt_expiry_idx" ON "tenant_mcp_oauth_attempt" ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_mcp_oauth_client_active_uidx" ON "tenant_mcp_oauth_client" ("organization_id","tenant_id",coalesce("tenant_user_id", '00000000-0000-0000-0000-000000000000'::uuid),coalesce("organization_server_id", '00000000-0000-0000-0000-000000000000'::uuid),coalesce("tenant_server_id", '00000000-0000-0000-0000-000000000000'::uuid),"server_auth_revision","issuer","resource") WHERE "active";--> statement-breakpoint
ALTER TABLE "mcp_connection" ADD CONSTRAINT "mcp_connection_FsiUkbB75BnC_fkey" FOREIGN KEY ("organization_id","server_id") REFERENCES "mcp_server"("organization_id","id") ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "mcp_connection" ADD CONSTRAINT "mcp_connection_FyCtsHPgMwDq_fkey" FOREIGN KEY ("organization_id","oauth_client_id") REFERENCES "mcp_oauth_client"("organization_id","id") DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "mcp_oauth_attempt" ADD CONSTRAINT "mcp_oauth_attempt_vxva7LQYW3M5_fkey" FOREIGN KEY ("organization_id","connection_id") REFERENCES "mcp_connection"("organization_id","id") ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "mcp_oauth_client" ADD CONSTRAINT "mcp_oauth_client_hWIM9jbMQLxx_fkey" FOREIGN KEY ("organization_id","server_id") REFERENCES "mcp_server"("organization_id","id") ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "mcp_server" ADD CONSTRAINT "mcp_server_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "tenant_mcp_connection" ADD CONSTRAINT "tenant_mcp_connection_MBszXMHUzYJK_fkey" FOREIGN KEY ("organization_id","tenant_id") REFERENCES "tenant"("organization_id","id") ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "tenant_mcp_connection" ADD CONSTRAINT "tenant_mcp_connection_yyXXzQReMoWC_fkey" FOREIGN KEY ("organization_id","tenant_id","tenant_user_id") REFERENCES "tenant_user"("organization_id","tenant_id","id") ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "tenant_mcp_connection" ADD CONSTRAINT "tenant_mcp_connection_gq3k4bsRWnvP_fkey" FOREIGN KEY ("organization_id","organization_server_id") REFERENCES "mcp_server"("organization_id","id") ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "tenant_mcp_connection" ADD CONSTRAINT "tenant_mcp_connection_ZrzR1sqb3zE5_fkey" FOREIGN KEY ("organization_id","tenant_id","tenant_server_id") REFERENCES "tenant_mcp_server"("organization_id","tenant_id","id") ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "tenant_mcp_connection" ADD CONSTRAINT "tenant_mcp_connection_GEGXbIWrRI0I_fkey" FOREIGN KEY ("organization_id","organization_o_auth_client_id") REFERENCES "mcp_oauth_client"("organization_id","id") DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "tenant_mcp_connection" ADD CONSTRAINT "tenant_mcp_connection_Uc5KxcmYpFSY_fkey" FOREIGN KEY ("organization_id","tenant_id","tenant_o_auth_client_id") REFERENCES "tenant_mcp_oauth_client"("organization_id","tenant_id","id") DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "tenant_mcp_oauth_attempt" ADD CONSTRAINT "tenant_mcp_oauth_attempt_eLmNXWprjSpj_fkey" FOREIGN KEY ("organization_id","tenant_id","connection_id") REFERENCES "tenant_mcp_connection"("organization_id","tenant_id","id") ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "tenant_mcp_oauth_client" ADD CONSTRAINT "tenant_mcp_oauth_client_NX1OzvtuMcPl_fkey" FOREIGN KEY ("organization_id","tenant_id") REFERENCES "tenant"("organization_id","id") ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "tenant_mcp_oauth_client" ADD CONSTRAINT "tenant_mcp_oauth_client_GXMGfxZHBzXT_fkey" FOREIGN KEY ("organization_id","tenant_id","tenant_user_id") REFERENCES "tenant_user"("organization_id","tenant_id","id") ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "tenant_mcp_oauth_client" ADD CONSTRAINT "tenant_mcp_oauth_client_F7KAvaWWCHbS_fkey" FOREIGN KEY ("organization_id","organization_server_id") REFERENCES "mcp_server"("organization_id","id") ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "tenant_mcp_oauth_client" ADD CONSTRAINT "tenant_mcp_oauth_client_zcDHYq01DpkM_fkey" FOREIGN KEY ("organization_id","tenant_id","tenant_server_id") REFERENCES "tenant_mcp_server"("organization_id","tenant_id","id") ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "tenant_mcp_server" ADD CONSTRAINT "tenant_mcp_server_npiCNfFEQuKH_fkey" FOREIGN KEY ("organization_id","tenant_id") REFERENCES "tenant"("organization_id","id") ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "tenant_mcp_server" ADD CONSTRAINT "tenant_mcp_server_HKebNNoFNBPT_fkey" FOREIGN KEY ("organization_id","tenant_id","tenant_user_id") REFERENCES "tenant_user"("organization_id","tenant_id","id") ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
