ALTER TABLE "organization" ADD COLUMN "domain" text;--> statement-breakpoint
UPDATE "organization" AS o SET "domain" = COALESCE((
  SELECT lower(split_part(u.email::text, '@', 2))
  FROM "member" AS m JOIN "user" AS u ON u.id = m.user_id
  WHERE m.organization_id = o.id
    AND lower(split_part(u.email::text, '@', 2)) <> 'astralbeam.ai'
  ORDER BY m.created_at, m.id LIMIT 1
), 'astralbeam.ai'), "updated_at" = now();--> statement-breakpoint
ALTER TABLE "organization" ALTER COLUMN "domain" SET NOT NULL;
