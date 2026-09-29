import { HttpServerResponse } from "effect/unstable/http"

import { artifactContentDisposition, isInlineArtifactMimeType } from "@/lib/chat/artifacts.server"
import type { ChatArtifact } from "@/lib/chat/sandbox.server"

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
