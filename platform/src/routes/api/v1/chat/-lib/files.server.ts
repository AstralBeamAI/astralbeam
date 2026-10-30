import { HttpServerResponse } from "effect/http"
import { HttpApiSchema } from "effect/http-api"
import { Effect, Schema } from "effect"

import { ChatFileUnavailable } from "@/lib/chat/threads/errors"
import { assetProxyResponse } from "@/lib/storage/asset-proxy.server"

import { artifactContentDisposition, isInlineArtifactMimeType } from "@/lib/chat/sandbox/artifacts"

export const chatFileSuccess = [
  HttpApiSchema.WithHeaders(HttpApiSchema.StreamUint8Array({ contentType: "*/*" }), {
    "Content-Disposition": Schema.String,
    "Content-Length": Schema.String,
  }),
  HttpApiSchema.NoContent,
] as const

export const chatArtifactResponse = Effect.fn("chatArtifactResponse")(function* (
  file: ({ bytes: Uint8Array; mimeType: string } | { url: string | undefined }) & {
    path: string
    preview?: boolean
  },
) {
  let response: Response
  if ("url" in file) {
    if (file.url === undefined) return HttpServerResponse.empty({ status: 204 })
    response = yield* assetProxyResponse(file.url).pipe(
      Effect.mapError(() => new ChatFileUnavailable()),
    )
  } else {
    if (file.preview && file.bytes.length === 0) return HttpServerResponse.empty({ status: 204 })
    response = new Response(file.bytes as BodyInit, {
      headers: {
        "content-type": file.mimeType,
        "content-length": String(file.bytes.byteLength),
      },
    })
  }
  return HttpServerResponse.setHeaders(HttpServerResponse.fromWeb(response), {
    "content-disposition": artifactContentDisposition(
      "url" in file || isInlineArtifactMimeType(file.mimeType) ? "inline" : "attachment",
      file.path,
    ),
    "cache-control": "private, no-store",
    // File access is rechecked on every request. Token renewal does not change the bytes.
    vary: "X-File-Preview",
    "x-content-type-options": "nosniff",
    "content-security-policy": "sandbox; default-src 'none'",
  })
})
