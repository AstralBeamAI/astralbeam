import { resolveHarnessCwd } from "@tanstack/ai-sandbox"
import * as Effect from "effect/Effect"

import { runDatabaseEffect } from "@/db"
import { resolveOrganizationSandboxProviderConfiguration } from "@/db/organization-sandbox-provider.server"
import { createSandboxProvider } from "@/lib/sandbox/factory.server"
import {
  artifactContentDigest,
  detectSandboxArtifactMimeType,
  verifySandboxArtifactTicket,
} from "./artifacts.server"
import { CHAT_SANDBOX_FILE_TIMEOUT_MS, CHAT_SANDBOX_MAX_ARTIFACT_BYTES } from "./constants.server"
import { resolveSandboxPath } from "./sandbox-tools.server"
import { chatError } from "./errors.server"

export async function readChatFile(token: string) {
  const ticket = await verifySandboxArtifactTicket(token)
  if (!ticket) {
    throw chatError(
      "NotFound",
      "The download has expired. Ask the agent to publish the file again.",
    )
  }
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
    throw chatError("NotFound", "The sandbox is gone; ask the agent to regenerate the file.")
  }
  // The ticket's path was containment-checked at publish time; re-check against the
  // resumed workspace so a root that moved cannot turn it into an escape.
  const resolved = resolveSandboxPath(resolveHarnessCwd(handle), ticket.path)
  if ("refusal" in resolved || resolved.path !== ticket.path) {
    throw chatError("NotFound", "The file is no longer available.")
  }
  const bytes = await handle.fs.readBytes(resolved.path)
  if (bytes.byteLength > CHAT_SANDBOX_MAX_ARTIFACT_BYTES) {
    throw chatError("NotFound", "The file has grown past the artifact size limit.")
  }
  // The capability covers exactly the published bytes: a same-type overwrite must be
  // republished, so the digest decides and the sniff is re-run for the response header.
  if (await artifactContentDigest(bytes) !== ticket.sha256) {
    throw chatError("NotFound", "The file changed since it was published.")
  }
  const mimeType = detectSandboxArtifactMimeType(bytes)
  if (mimeType !== ticket.mimeType) {
    throw chatError("NotFound", "The file changed since it was published.")
  }
  return { bytes, mimeType, path: resolved.path }
}
