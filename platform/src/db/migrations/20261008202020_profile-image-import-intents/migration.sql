CREATE OR REPLACE FUNCTION replace_user_avatar() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE file_object f SET expires_at = NULL FROM user_avatar a
    WHERE a.user_id = NEW.id AND a.id = f.id AND f.verified_at IS NOT NULL
      AND NEW.image = '/api/files/avatars/' || a.id;
  IF OLD.image IS DISTINCT FROM NEW.image THEN
    DELETE FROM user_avatar WHERE user_id = NEW.id AND OLD.image = '/api/files/avatars/' || id;
  END IF;
  IF NEW.image IS NULL OR EXISTS (SELECT 1 FROM user_avatar WHERE user_id = NEW.id
      AND NEW.image = '/api/files/avatars/' || id AND source_kind = 'manual') THEN
    INSERT INTO user_image_import(user_id, status) VALUES (NEW.id, 'disabled')
      ON CONFLICT (user_id) DO UPDATE SET source_url = NULL, status = 'disabled', generation = uuidv7(), updated_at = now();
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER user_avatar_replacement ON "user";
--> statement-breakpoint
CREATE TRIGGER user_avatar_replacement AFTER UPDATE OF image ON "user" FOR EACH ROW EXECUTE FUNCTION replace_user_avatar();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION replace_organization_logo() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE file_object f SET expires_at = NULL FROM organization_logo l
    WHERE l.organization_id = NEW.id AND l.id = f.id AND f.verified_at IS NOT NULL
      AND NEW.logo = '/api/files/organizations/' || NEW.id || '/logos/' || l.id;
  IF OLD.logo IS DISTINCT FROM NEW.logo THEN
    DELETE FROM organization_logo WHERE organization_id = NEW.id
      AND OLD.logo = '/api/files/organizations/' || NEW.id || '/logos/' || id;
  END IF;
  IF NEW.logo IS NULL THEN
    UPDATE organization_image_import SET source_url = '', status = 'disabled', generation = uuidv7(), updated_at = now()
      WHERE organization_id = NEW.id AND status IN ('pending', 'superseded');
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER organization_logo_replacement ON organization;
--> statement-breakpoint
CREATE TRIGGER organization_logo_replacement AFTER UPDATE OF logo ON organization FOR EACH ROW EXECUTE FUNCTION replace_organization_logo();
