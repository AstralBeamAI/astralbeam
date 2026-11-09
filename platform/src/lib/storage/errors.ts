import { Schema } from "effect"

export class StorageUnavailable extends Schema.TaggedError<
  StorageUnavailable,
  { readonly brand: unique symbol }
>()("StorageUnavailable", {}, { httpApiStatus: 503 }) {
  override readonly message =
    "File storage is unavailable. Check the storage configuration or try again."
}

export class StorageObjectMissing extends Schema.TaggedError<
  StorageObjectMissing,
  { readonly brand: unique symbol }
>()("StorageObjectMissing", {}, { httpApiStatus: 404 }) {
  override readonly message = "The file is unavailable"
}

export class InvalidImage extends Schema.TaggedError<
  InvalidImage,
  { readonly brand: unique symbol }
>()("InvalidImage", {}, { httpApiStatus: 422 }) {
  override readonly message =
    "Use a valid, non-animated PNG, JPEG, GIF, or WebP image no larger than 2 MiB and 16 megapixels."
}

export class ImageImportUnavailable extends Schema.TaggedError<
  ImageImportUnavailable,
  { readonly brand: unique symbol }
>()("ImageImportUnavailable", {}, { httpApiStatus: 503 }) {
  override readonly message = "The image could not be imported. Please try again."
}

export class ImageUploadRateLimited extends Schema.TaggedError<
  ImageUploadRateLimited,
  { readonly brand: unique symbol }
>()("ImageUploadRateLimited", {}, { httpApiStatus: 429 }) {
  override readonly message = "Too many image uploads. Please try again in a few minutes."
}
