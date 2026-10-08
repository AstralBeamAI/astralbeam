import { HttpServerResponse } from "effect/http"
import { Effect } from "effect"
import { objectStorageStream } from "@/lib/storage/object-storage.server"
import { ChatThreadStorageUnavailable } from "@/lib/chat/threads/errors"
import type { StoredFile } from "@/lib/storage/stored-files.server"

import {
  artifactContentDisposition,
  isInlineArtifactMimeType,
} from "@/lib/chat/sandbox/artifacts.server"
import type { ChatArtifact } from "@/lib/chat/sandbox/sandbox.server"

export const chatStoredFileResponse = Effect.fn("chatStoredFileResponse")(function* (
  file: StoredFile,
  path: string,
) {
  const stream = yield* objectStorageStream(file).pipe(
    Effect.mapError(() => new ChatThreadStorageUnavailable()),
  )
  return HttpServerResponse.stream(stream, {
    contentType: file.contentType,
    headers: {
      "Content-Disposition": artifactContentDisposition(
        isInlineArtifactMimeType(file.contentType) ? "inline" : "attachment",
        path,
      ),
      "Content-Length": String(file.byteSize),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'",
    },
  })
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
