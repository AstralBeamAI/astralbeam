import { HttpServerResponse } from "effect/http"

import { artifactContentDisposition } from "@/lib/chat/sandbox/artifacts"

export function chatArtifactResponse({
  bytes,
  mimeType,
  path,
}: {
  bytes: Uint8Array
  mimeType: string
  path: string
}) {
  return HttpServerResponse.uint8Array(bytes, {
    contentType: mimeType,
    headers: {
      "content-disposition": artifactContentDisposition(
        mimeType.startsWith("image/") ? "inline" : "attachment",
        path,
      ),
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox; default-src 'none'",
    },
  })
}
