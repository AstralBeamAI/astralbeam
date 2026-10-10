import type { MigrationClient } from "../../migration-log.server.ts"

export async function up(client: MigrationClient): Promise<void> {
  await client.query(`
    insert into user_image_import (user_id, status)
    select id, 'pending' from "user"
    where image is null or image not like '/api/files/%'
    on conflict (user_id) do nothing
  `)
  await client.query(`
    insert into organization_image_import (organization_id, generation, status)
    select id, coalesce(logo_import_generation, uuidv7()), 'pending' from organization
    where logo is not null and logo not like '/api/files/%' and logo_import_source_url is null
    on conflict (organization_id) do nothing
  `)
}
