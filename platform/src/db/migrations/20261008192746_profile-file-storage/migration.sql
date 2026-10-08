CREATE TYPE "profile_image_import_status" AS ENUM('pending', 'imported', 'unavailable', 'disabled', 'superseded');--> statement-breakpoint
CREATE TYPE "user_avatar_source_kind" AS ENUM('manual', 'external', 'gravatar');--> statement-breakpoint
CREATE TABLE "file_deletion" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"object_key" text NOT NULL,
	"retry_at" timestamp with time zone DEFAULT now() + interval '1 minute' NOT NULL,
	"attempts" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_object" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"object_key" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"sha256" text NOT NULL,
	"source_identity" text,
	"verified_at" timestamp with time zone,
	"expires_at" timestamp with time zone DEFAULT now() + interval '24 hours',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_object_size_check" CHECK ("byte_size" >= 0),
	CONSTRAINT "file_object_sha256_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "organization_image_import" (
	"organization_id" uuid,
	"id" uuid DEFAULT uuidv7(),
	"source_url" text NOT NULL,
	"expected_logo" text,
	"generation" uuid DEFAULT uuidv7() NOT NULL,
	"status" "profile_image_import_status" NOT NULL,
	"reason" text,
	"attempts" bigint DEFAULT 0 NOT NULL,
	"retry_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_image_import_pkey" PRIMARY KEY("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "organization_logo" (
	"organization_id" uuid,
	"id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_logo_pkey" PRIMARY KEY("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "user_avatar" (
	"user_id" uuid,
	"id" uuid,
	"source_kind" "user_avatar_source_kind" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_avatar_pkey" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "user_image_import" (
	"user_id" uuid PRIMARY KEY,
	"source_url" text,
	"expected_image" text,
	"generation" uuid DEFAULT uuidv7() NOT NULL,
	"status" "profile_image_import_status" NOT NULL,
	"reason" text,
	"attempts" bigint DEFAULT 0 NOT NULL,
	"retry_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "logo_file_id" uuid;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "avatar_file_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "file_deletion_key_uidx" ON "file_deletion" ("object_key");--> statement-breakpoint
CREATE INDEX "file_deletion_retry_idx" ON "file_deletion" ("retry_at");--> statement-breakpoint
CREATE UNIQUE INDEX "file_object_key_uidx" ON "file_object" ("object_key");--> statement-breakpoint
CREATE UNIQUE INDEX "file_object_source_identity_uidx" ON "file_object" ("source_identity");--> statement-breakpoint
CREATE INDEX "file_object_expiry_idx" ON "file_object" ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_image_import_owner_uidx" ON "organization_image_import" ("organization_id");--> statement-breakpoint
CREATE INDEX "organization_image_import_retry_idx" ON "organization_image_import" ("retry_at") WHERE "status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "organization_logo_file_uidx" ON "organization_logo" ("id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_avatar_file_uidx" ON "user_avatar" ("id");--> statement-breakpoint
CREATE INDEX "user_image_import_retry_idx" ON "user_image_import" ("retry_at") WHERE "status" = 'pending';--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_logo_current_fk" FOREIGN KEY ("id","logo_file_id") REFERENCES "organization_logo"("organization_id","id") DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "organization_image_import" ADD CONSTRAINT "organization_image_import_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "organization_logo" ADD CONSTRAINT "organization_logo_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "organization_logo" ADD CONSTRAINT "organization_logo_id_file_object_id_fkey" FOREIGN KEY ("id") REFERENCES "file_object"("id") ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_avatar_current_fk" FOREIGN KEY ("id","avatar_file_id") REFERENCES "user_avatar"("user_id","id") DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "user_avatar" ADD CONSTRAINT "user_avatar_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "user_avatar" ADD CONSTRAINT "user_avatar_id_file_object_id_fkey" FOREIGN KEY ("id") REFERENCES "file_object"("id") ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "user_image_import" ADD CONSTRAINT "user_image_import_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
--> statement-breakpoint
CREATE FUNCTION retain_file_deletion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO file_deletion (object_key) VALUES (OLD.object_key) ON CONFLICT DO NOTHING;
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER file_object_deletion BEFORE DELETE ON file_object FOR EACH ROW EXECUTE FUNCTION retain_file_deletion();
--> statement-breakpoint
CREATE FUNCTION release_profile_file() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM file_object WHERE id = OLD.id
    AND NOT EXISTS (SELECT 1 FROM user_avatar WHERE id = OLD.id)
    AND NOT EXISTS (SELECT 1 FROM organization_logo WHERE id = OLD.id);
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER user_avatar_release AFTER DELETE ON user_avatar FOR EACH ROW EXECUTE FUNCTION release_profile_file();
--> statement-breakpoint
CREATE TRIGGER organization_logo_release AFTER DELETE ON organization_logo FOR EACH ROW EXECUTE FUNCTION release_profile_file();
--> statement-breakpoint
CREATE FUNCTION replace_user_avatar() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE file_object f SET expires_at = NULL FROM user_avatar a
    WHERE a.user_id = NEW.id AND a.id = f.id AND f.verified_at IS NOT NULL
      AND NEW.image = '/api/files/avatars/' || a.id;
  DELETE FROM user_avatar WHERE user_id = NEW.id AND OLD.image = '/api/files/avatars/' || id;
  IF NEW.image IS NULL OR EXISTS (SELECT 1 FROM user_avatar WHERE user_id = NEW.id
      AND NEW.image = '/api/files/avatars/' || id AND source_kind = 'manual') THEN
    UPDATE user_image_import SET source_url = NULL, status = 'disabled', generation = uuidv7(), updated_at = now() WHERE user_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER user_avatar_replacement AFTER UPDATE OF image ON "user" FOR EACH ROW WHEN (OLD.image IS DISTINCT FROM NEW.image) EXECUTE FUNCTION replace_user_avatar();
--> statement-breakpoint
CREATE FUNCTION replace_organization_logo() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE file_object f SET expires_at = NULL FROM organization_logo l
    WHERE l.organization_id = NEW.id AND l.id = f.id AND f.verified_at IS NOT NULL
      AND NEW.logo = '/api/files/organizations/' || NEW.id || '/logos/' || l.id;
  DELETE FROM organization_logo WHERE organization_id = NEW.id
    AND OLD.logo = '/api/files/organizations/' || NEW.id || '/logos/' || id;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER organization_logo_replacement AFTER UPDATE OF logo ON organization FOR EACH ROW WHEN (OLD.logo IS DISTINCT FROM NEW.logo) EXECUTE FUNCTION replace_organization_logo();

--> statement-breakpoint
CREATE FUNCTION link_user_avatar() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.avatar_file_id = CASE WHEN NEW.image ~ '^/api/files/avatars/[0-9a-f-]{36}$' THEN substring(NEW.image from 20)::uuid ELSE NULL END;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER user_avatar_link BEFORE UPDATE OF image ON "user" FOR EACH ROW EXECUTE FUNCTION link_user_avatar();
--> statement-breakpoint
CREATE FUNCTION link_organization_logo() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.logo_file_id = CASE WHEN NEW.logo LIKE '/api/files/organizations/' || NEW.id || '/logos/%' THEN substring(NEW.logo from '/logos/([0-9a-f-]{36})$')::uuid ELSE NULL END;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER organization_logo_link BEFORE UPDATE OF logo ON organization FOR EACH ROW EXECUTE FUNCTION link_organization_logo();
