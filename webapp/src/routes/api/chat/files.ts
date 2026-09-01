import { resolveHarnessCwd } from "@tanstack/ai-sandbox"
import { createFileRoute } from "@tanstack/react-router"
import * as Effect from "effect/Effect"

import { runDatabaseEffect } from "@/db"
import { resolveOrganizationSandboxProviderConfiguration } from "@/db/organization-sandbox-provider.server"
import { createSandboxProvider } from "@/lib/sandbox/factory.server"
import {
  artifactContentDigest,
  artifactContentDisposition,
  detectSandboxArtifactMimeType,
  isInlineArtifactMimeType,
  verifySandboxArtifactTicket,
} from "./-lib/artifacts.server"
import {
  CHAT_SANDBOX_FILE_TIMEOUT_MS,
  CHAT_SANDBOX_MAX_ARTIFACT_BYTES,
} from "./-lib/constants.server"
import { resolveSandboxPath } from "./-lib/sandbox-tools.server"
import { corsHeaders, errorResponse } from "./-lib/utils.server"

/**
 * Serves one published sandbox artifact. The ticket in the query is the whole capability — a
 * process-local signed claim minted by `sandbox_publish_artifact` — because an `<img src>` cannot
 * carry a bearer header. Everything about the response is re-derived from the live sandbox at
 * serve time: the bytes are re-read, re-sniffed, and re-capped, so a file that changed since
 * publishing cannot be smuggled out under a stale content type.
 */
export const Route = createFileRoute("/api/chat/files")({
  server: {
    handlers: {
      OPTIONS: ({ request }) => new Response(null, { status: 204, headers: corsHeaders(request) }),
      GET: async ({ request }) => {
        const token = new URL(request.url).searchParams.get("ticket")
        if (!token) return errorResponse(request, 400, "A ticket is required.")
        const ticket = await verifySandboxArtifactTicket(token)
        if (!ticket) {
          return errorResponse(
            request,
            404,
            "The download has expired. Ask the agent to publish the file again.",
          )
        }
        try {
          const provider = await runDatabaseEffect(
            resolveOrganizationSandboxProviderConfiguration(
              ticket.organizationId,
              ticket.sandboxProviderId,
            ).pipe(
              Effect.flatMap((configuration) =>
                createSandboxProvider(configuration.provider, configuration)
              ),
            ),
          )
          // Resume-only, never create: a gone sandbox means a gone file, not a fresh sandbox.
          const handle = await provider.resume({
            id: ticket.providerSandboxId,
            signal: AbortSignal.timeout(CHAT_SANDBOX_FILE_TIMEOUT_MS),
          })
          if (!handle) {
            return errorResponse(
              request,
              404,
              "The sandbox is gone; ask the agent to regenerate the file.",
            )
          }
          // The ticket's path was containment-checked at publish time; re-check against the
          // resumed workspace so a root that moved cannot turn it into an escape.
          const resolved = resolveSandboxPath(resolveHarnessCwd(handle), ticket.path)
          if ("refusal" in resolved || resolved.path !== ticket.path) {
            return errorResponse(request, 404, "The file is no longer available.")
          }
          const bytes = await handle.fs.readBytes(resolved.path)
          if (bytes.byteLength > CHAT_SANDBOX_MAX_ARTIFACT_BYTES) {
            return errorResponse(request, 404, "The file has grown past the artifact size limit.")
          }
          // The capability covers exactly the published bytes: a same-type overwrite must be
          // republished, so the digest decides and the sniff is re-run for the response header.
          if (await artifactContentDigest(bytes) !== ticket.sha256) {
            return errorResponse(request, 404, "The file changed since it was published.")
          }
          const mimeType = detectSandboxArtifactMimeType(bytes)
          if (mimeType !== ticket.mimeType) {
            return errorResponse(request, 404, "The file changed since it was published.")
          }
          const disposition = isInlineArtifactMimeType(mimeType) ? "inline" : "attachment"
          return new Response(bytes as BodyInit, {
            headers: {
              ...corsHeaders(request),
              "content-type": mimeType,
              "content-disposition": artifactContentDisposition(disposition, resolved.path),
              "content-length": String(bytes.byteLength),
              "cache-control": "private, no-store",
              "x-content-type-options": "nosniff",
              // Defense in depth for anything a browser might interpret: no scripts, no frame.
              "content-security-policy": "sandbox; default-src 'none'",
            },
          })
        } catch (error) {
          console.error("Failed to serve a /api/chat sandbox artifact:", error)
          return errorResponse(request, 500, "The file could not be served.")
        }
      },
    },
  },
})
