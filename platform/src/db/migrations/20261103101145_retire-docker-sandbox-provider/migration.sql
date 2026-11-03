UPDATE "agent" AS a
SET "sandbox_provider_id" = NULL,
    "lock_version" = a."lock_version" + 1,
    "updated_at" = now()
FROM "sandbox_provider" AS p
WHERE a."organization_id" = p."organization_id"
  AND a."sandbox_provider_id" = p."id"
  AND p."provider_type" = 'docker';
--> statement-breakpoint
DELETE FROM "sandbox_provider" WHERE "provider_type" = 'docker';
