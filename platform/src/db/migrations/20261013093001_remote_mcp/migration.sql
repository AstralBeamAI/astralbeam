CREATE TABLE "mcp_connection" (
	"organization_id" uuid,
	"tenant_id" uuid,
	"id" uuid DEFAULT uuidv7(),
	"tenant_user_id" uuid NOT NULL,
	"mcp_server_id" uuid NOT NULL,
	"credentials" text,
	"lock_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_connection_pkey" PRIMARY KEY("organization_id","tenant_id","id"),
	CONSTRAINT "mcp_connection_owner_server_uidx" UNIQUE("organization_id","tenant_id","tenant_user_id","mcp_server_id")
);
--> statement-breakpoint
CREATE TABLE "mcp_server" (
	"organization_id" uuid,
	"id" uuid DEFAULT uuidv7(),
	"endpoint_url" text NOT NULL,
	"auth_config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_server_pkey" PRIMARY KEY("organization_id","id"),
	CONSTRAINT "mcp_server_endpoint_uidx" UNIQUE("organization_id","endpoint_url")
);
--> statement-breakpoint
ALTER TABLE "mcp_connection" ADD CONSTRAINT "mcp_connection_1Th9UqXvL2Kh_fkey" FOREIGN KEY ("organization_id","tenant_id","tenant_user_id") REFERENCES "tenant_user"("organization_id","tenant_id","id") ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "mcp_connection" ADD CONSTRAINT "mcp_connection_DGP2PG7HfgOP_fkey" FOREIGN KEY ("organization_id","mcp_server_id") REFERENCES "mcp_server"("organization_id","id") ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "mcp_server" ADD CONSTRAINT "mcp_server_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;