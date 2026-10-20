LOCK TABLE "organization", "member", "chat_file" IN SHARE ROW EXCLUSIVE MODE;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT organization_id, user_id
    FROM member
    GROUP BY organization_id, user_id
    HAVING count(*) > 1 AND (
      count(DISTINCT ARRAY(SELECT DISTINCT role_name FROM unnest(string_to_array(role, ',')) AS role_name ORDER BY role_name)) > 1
      OR bool_or(NOT string_to_array(role, ',') <@ ARRAY['owner', 'developer', 'viewer']::text[])
      OR bool_or(cardinality(string_to_array(role, ',')) = 0)
    )
  ) THEN
    RAISE EXCEPTION 'Conflicting duplicate organization memberships. Review the membership reconciliation query in the database guide, reconcile roles, and retry.';
  END IF;
END $$;--> statement-breakpoint
CREATE TEMP TABLE member_reconciliation ON COMMIT DROP AS
SELECT id, organization_id, user_id, avatar_file_id,
  first_value(id) OVER (PARTITION BY organization_id, user_id ORDER BY id) AS retained_id,
  first_value(avatar_file_id) OVER (
    PARTITION BY organization_id, user_id ORDER BY (avatar_file_id IS NULL), id
  ) AS retained_avatar_file_id
FROM member;--> statement-breakpoint
UPDATE member AS retained
SET avatar_file_id = source.retained_avatar_file_id, updated_at = clock_timestamp()
FROM member_reconciliation AS source
WHERE retained.id = source.id AND source.id = source.retained_id
  AND retained.avatar_file_id IS NULL AND source.retained_avatar_file_id IS NOT NULL;--> statement-breakpoint
DELETE FROM member USING member_reconciliation AS source
WHERE member.id = source.id AND source.id <> source.retained_id;--> statement-breakpoint
UPDATE file_object AS file
SET status = 'purging', updated_at = clock_timestamp()
WHERE EXISTS (
  SELECT 1 FROM member_reconciliation AS source
  WHERE source.id <> source.retained_id AND source.organization_id = file.organization_id
    AND source.avatar_file_id = file.id
)
AND NOT EXISTS (SELECT 1 FROM member WHERE member.organization_id = file.organization_id AND member.avatar_file_id = file.id)
AND NOT EXISTS (SELECT 1 FROM organization WHERE organization.id = file.organization_id AND organization.logo_file_id = file.id)
AND NOT EXISTS (SELECT 1 FROM chat_file WHERE chat_file.organization_id = file.organization_id AND chat_file.file_object_id = file.id);--> statement-breakpoint
DROP INDEX "member_organization_id_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "member_organization_user_uidx" ON "member" ("organization_id","user_id");
