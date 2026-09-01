ALTER TABLE "organization_configuration" ADD COLUMN "default_agent_id" uuid;--> statement-breakpoint
ALTER TABLE "agent" ALTER COLUMN "sandbox_provider_id" DROP NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_organization_id_id_uidx" ON "agent" ("organization_id","id");--> statement-breakpoint
ALTER TABLE "organization_configuration" ADD CONSTRAINT "organization_configuration_default_agent_id_fk" FOREIGN KEY ("organization_id","default_agent_id") REFERENCES "agent"("organization_id","id") ON DELETE RESTRICT;--> statement-breakpoint
-- Backfill so every existing organization has the starter agent the application now creates with
-- a new organization, keeping the name within the 100-character limit the agent form enforces.
INSERT INTO "agent" ("organization_id", "slug", "name", "system_prompt")
SELECT
  "organization"."id",
  'assistant',
  CASE
    WHEN char_length("organization"."name") <= 90 THEN "organization"."name" || ' Assistant'
    ELSE rtrim(left("organization"."name", 90)) || ' Assistant'
  END,
  'You are the assistant for ' || "organization"."name" || '. Help its users with their '
    || 'questions and tasks inside the application you are embedded in, acting through the tools '
    || 'and widgets that application declares. Ask one short clarifying question when a request '
    || 'is ambiguous, and say plainly when something is outside what you can do.'
FROM "organization"
WHERE NOT EXISTS (
  SELECT 1 FROM "agent" WHERE "agent"."organization_id" = "organization"."id"
);--> statement-breakpoint
-- Every organization then gets a default agent, matching the order the agents page lists them in.
INSERT INTO "organization_configuration" ("organization_id", "default_agent_id")
SELECT DISTINCT ON ("organization_id") "organization_id", "id"
FROM "agent"
ORDER BY "organization_id", "name", "id"
ON CONFLICT ("organization_id") DO UPDATE
  SET "default_agent_id" = EXCLUDED."default_agent_id", "updated_at" = now()
  WHERE "organization_configuration"."default_agent_id" IS NULL;
