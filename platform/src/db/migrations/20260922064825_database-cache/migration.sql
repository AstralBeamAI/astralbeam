CREATE TABLE "cache_entry" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"namespace" text NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cache_entry_namespace_length" CHECK (char_length("namespace") <= 64),
	CONSTRAINT "cache_entry_key_length" CHECK (char_length("key") <= 512)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "cache_entry_namespace_key_uidx" ON "cache_entry" ("namespace","key");--> statement-breakpoint
CREATE INDEX "cache_entry_expires_at_idx" ON "cache_entry" ("expires_at","id") WHERE "expires_at" is not null;