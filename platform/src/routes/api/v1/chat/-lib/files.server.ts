import { HttpServerResponse } from "effect/http"
import { Effect } from "effect"
import { ChatThreadStorageUnavailable } from "@/lib/chat/threads/errors"
import { StoredFiles, type StoredFile } from "@/lib/storage/stored-files.server"

import {
  artifactContentDisposition,
  isInlineArtifactMimeType,
} from "@/lib/chat/sandbox/artifacts.server"
import type { ChatArtifact } from "@/lib/chat/sandbox/sandbox.server"

export const chatStoredFileResponse = Effect.fn("chatStoredFileResponse")(function* (
  file: StoredFile,
  path: string,
) {
  const bytes = yield* (yield* StoredFiles)
    .read(file)
    .pipe(Effect.mapError(() => new ChatThreadStorageUnavailable()))
  return chatArtifactResponse({ bytes, mimeType: file.contentType, path })
})

export function chatArtifactResponse({ bytes, mimeType, path }: ChatArtifact) {
  return HttpServerResponse.fromWeb(
    new Response(bytes as BodyInit, {
      headers: {
        "content-type": mimeType,
        "content-disposition": artifactContentDisposition(
          isInlineArtifactMimeType(mimeType) ? "inline" : "attachment",
          path,
        ),
        "content-length": String(bytes.byteLength),
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "content-security-policy": "sandbox; default-src 'none'",
      },
    }),
  )
}
