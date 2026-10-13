CREATE TYPE "file_object_status" AS ENUM('pending', 'stored', 'purging');--> statement-breakpoint
CREATE TABLE "file_object" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"object_key" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"sha256" text NOT NULL,
	"status" "file_object_status" DEFAULT 'pending'::"file_object_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "file_object_key_uidx" ON "file_object" ("object_key");--> statement-breakpoint
CREATE INDEX "file_object_status_created_at_idx" ON "file_object" ("status","created_at");