import { HttpServerResponse } from "effect/http"

import { artifactContentDisposition, isInlineArtifactMimeType } from "@/lib/chat/sandbox/artifacts"
import type { ChatArtifact } from "@/lib/chat/sandbox/sandbox"

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
