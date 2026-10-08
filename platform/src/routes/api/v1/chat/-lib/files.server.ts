import { HttpServerResponse } from "effect/http"
import { Effect } from "effect"
import { Config } from "@/lib/config/config.server"
import { objectStorageStream } from "@/lib/storage/object-storage.server"
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
  const config = yield* Config
  return HttpServerResponse.stream(objectStorageStream(file, config), {
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
