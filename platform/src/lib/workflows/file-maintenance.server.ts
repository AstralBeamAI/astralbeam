import { Effect } from "effect"

import { Uploads } from "@/lib/chat/attachments/uploads.server"
import { ProfileFiles } from "@/lib/storage/profile-files.server"
import { StoredFiles } from "@/lib/storage/stored-files.server"

const fileMaintenance = Effect.gen(function* () {
  yield* (yield* StoredFiles).cleanup
  yield* (yield* ProfileFiles).processImports
  yield* (yield* Uploads).maintenance
})

export default fileMaintenance
