import { HttpServerResponse } from "effect/http"
import { HttpApiSchema } from "effect/http-api"
import { Schema } from "effect"

import { artifactContentDisposition, isInlineArtifactMimeType } from "@/lib/chat/sandbox/artifacts"

export const chatFileSuccess = [
  HttpApiSchema.WithHeaders(HttpApiSchema.StreamUint8Array({ contentType: "*/*" }), {
    "Content-Disposition": Schema.String,
    "Content-Length": Schema.String,
  }),
  HttpApiSchema.WithHeaders(HttpApiSchema.NoContent, {
    Location: Schema.optionalKey(Schema.String),
  }),
] as const

export function chatArtifactResponse(
  input: ({ bytes: Uint8Array; mimeType: string } | { url: string }) & {
    path: string
    preview?: boolean
  },
) {
  if ("url" in input)
    return HttpServerResponse.empty({
      status: 204,
      headers: { Location: input.url, "Cache-Control": "private, no-store" },
    })
  const { bytes, mimeType, path, preview = false } = input
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
        "cache-control": isInlineArtifactMimeType(mimeType)
          ? "private, max-age=60, must-revalidate"
          : "private, no-store",
        vary: "Authorization, X-API-Key, X-File-Preview",
        "x-content-type-options": "nosniff",
        "content-security-policy": "sandbox; default-src 'none'",
      },
    }),
  )
}
