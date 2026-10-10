import { isNotNull } from "drizzle-orm"
import { Effect } from "effect"

import { Database } from "@/db/database"
import { mapDatabaseErrors } from "@/db/lib/sqlstate"
import { organization } from "@/db/schema/organizations"
import { StoredFiles } from "@/lib/storage/stored-files.server"
import profileImageImport from "./profile-image-import"

// Cleanup and import submission are repeatable. Each import's retries live in the workflow journal.
// Keep logo intent on the owner until completion, so interrupted submissions are rediscovered.
const fileMaintenance = Effect.gen(function* () {
  yield* (yield* StoredFiles).cleanup
  const db = yield* Database
  const logos = yield* db
    .select({ ownerId: organization.id, generation: organization.logoImportGeneration })
    .from(organization)
    .where(isNotNull(organization.logoImportSourceUrl))
    .pipe(mapDatabaseErrors())
  yield* Effect.forEach(
    logos,
    (owner) =>
      profileImageImport.execute(
        { image: { kind: "logo", ...owner, generation: owner.generation! } },
        { discard: true },
      ),
    { concurrency: 4, discard: true },
  )
})

export default fileMaintenance
