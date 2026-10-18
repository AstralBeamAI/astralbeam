import { HttpServerResponse } from "effect/http"
import { HttpApiSchema } from "effect/http-api"
import { Schema } from "effect"

import { artifactContentDisposition, isInlineArtifactMimeType } from "@/lib/chat/sandbox/artifacts"

export const chatFileSuccess = [
  HttpApiSchema.WithHeaders(HttpApiSchema.StreamUint8Array({ contentType: "*/*" }), {
    "Content-Disposition": Schema.String,
    "Content-Length": Schema.String,
  }),
  HttpApiSchema.NoContent,
] as const

export function chatArtifactResponse({
  bytes,
  mimeType,
  path,
  preview = false,
}: {
  bytes: Uint8Array
  mimeType: string
  path: string
  preview?: boolean
}) {
  if (preview && bytes.length === 0) return HttpServerResponse.empty({ status: 204 })
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
