import { Schema } from "effect"

// Better Auth's `/api-key/delete` answers with these messages beside its own error codes.

export class ApiKeyNotFound extends Schema.TaggedError<ApiKeyNotFound>()(
  "ApiKeyNotFound",
  {},
  { httpApiStatus: 404 },
) {
  override readonly message = "API key not found"
}

export class DogfoodApiKeyInUse extends Schema.TaggedError<DogfoodApiKeyInUse>()(
  "DogfoodApiKeyInUse",
  {},
  { httpApiStatus: 403 },
) {
  override readonly message =
    "This API key is used by the embedded assistant and cannot be deleted."
}

export class LastApiKey extends Schema.TaggedError<LastApiKey>()(
  "LastApiKey",
  {},
  { httpApiStatus: 403 },
) {
  override readonly message = "The last API key cannot be deleted. Create another key first."
}
