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

export class StorageDestinationLocked extends Schema.TaggedError<StorageDestinationLocked>()(
  "StorageDestinationLocked",
  {},
  { httpApiStatus: 409 },
) {
  override readonly message =
    "The file storage destination is locked. Moving stored files requires a storage migration."
}

export class InvalidImage extends Schema.TaggedError<InvalidImage>()(
  "InvalidImage",
  {},
  { httpApiStatus: 422 },
) {
  override readonly message =
    "Use a valid PNG, JPEG, GIF, or WebP image no larger than 2 MiB and 16 megapixels."
}

export class ImageSourceMissing extends Schema.TaggedError<ImageSourceMissing>()(
  "ImageSourceMissing",
  { status: Schema.Int },
) {
  override readonly message = "The external image is no longer available."
}

export class ImageImportUnavailable extends Schema.TaggedError<ImageImportUnavailable>()(
  "ImageImportUnavailable",
  {},
  { httpApiStatus: 503 },
) {
  override readonly message = "The image could not be imported. Please try again."
}

export class ImageUploadRateLimited extends Schema.TaggedError<ImageUploadRateLimited>()(
  "ImageUploadRateLimited",
  {},
  { httpApiStatus: 429 },
) {
  override readonly message = "Too many image uploads. Please try again in a few minutes."
}

export class MultipartMissing extends Schema.TaggedError<MultipartMissing>()(
  "MultipartMissing",
  {},
) {}
