import { artifactContentDisposition, isInlineArtifactMimeType } from "@/lib/chat/artifacts.server"
import { readChatFile } from "@/lib/chat/files.server"

export async function serveChatFile(token: string): Promise<Response> {
  const { bytes, mimeType, path } = await readChatFile(token)
  return new Response(bytes as BodyInit, {
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
  })
}
