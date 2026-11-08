import { Schema } from "effect"

export class ChatThreadNotFound extends Schema.TaggedError<
  ChatThreadNotFound,
  { readonly brand: unique symbol }
>()("ChatThreadNotFound", {}, { httpApiStatus: 404 }) {
  override readonly message = "This conversation is unavailable"
}

export class ChatThreadConflict extends Schema.TaggedError<
  ChatThreadConflict,
  { readonly brand: unique symbol }
>()("ChatThreadConflict", {}, { httpApiStatus: 409 }) {
  override readonly message = "This conversation changed or is busy. Reload and try again"
}

export class ChatThreadForbidden extends Schema.TaggedError<
  ChatThreadForbidden,
  { readonly brand: unique symbol }
>()("ChatThreadForbidden", {}, { httpApiStatus: 403 }) {
  override readonly message = "Your conversation role does not allow this action"
}

export class ChatThreadInvalid extends Schema.TaggedError<
  ChatThreadInvalid,
  { readonly brand: unique symbol }
>()("ChatThreadInvalid", {}, { httpApiStatus: 400 }) {
  override readonly message = "This conversation operation is invalid"
}

export class ChatIdentityNotSynchronized extends Schema.TaggedError<
  ChatIdentityNotSynchronized,
  { readonly brand: unique symbol }
>()("ChatIdentityNotSynchronized", {}, { httpApiStatus: 409 }) {
  override readonly message =
    "Synchronize your identity with POST /api/v1/me before opening saved conversations"
}

export class ChatFileUnavailable extends Schema.TaggedError<
  ChatFileUnavailable,
  { readonly brand: unique symbol }
>()("ChatFileUnavailable", {}, { httpApiStatus: 503 }) {
  override readonly message = "File storage is temporarily unavailable"
}

export type ChatThreadError =
  | ChatFileUnavailable
  | ChatThreadNotFound
  | ChatThreadConflict
  | ChatThreadForbidden
  | ChatThreadInvalid
