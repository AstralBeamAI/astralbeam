CREATE TABLE "config" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "config_session" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"token_hash" text NOT NULL,
	"db_username" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "config_key_uidx" ON "config" ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "config_session_token_hash_uidx" ON "config_session" ("token_hash");