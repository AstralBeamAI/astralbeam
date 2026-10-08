import { Schema } from "effect"

export class StorageUnavailable extends Schema.TaggedError<StorageUnavailable>()(
  "StorageUnavailable",
  {},
  { httpApiStatus: 503 },
) {
  override readonly message =
    "File storage is unavailable. Check the storage configuration or try again."
}

export class StorageObjectMissing extends Schema.TaggedError<StorageObjectMissing>()(
  "StorageObjectMissing",
  {},
  { httpApiStatus: 404 },
) {
  override readonly message = "The file is unavailable"
}
