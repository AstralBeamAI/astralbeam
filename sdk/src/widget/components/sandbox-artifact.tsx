import { DownloadSimpleIcon, FileArrowDownIcon, WarningCircleIcon } from "@phosphor-icons/react"
import { getChatFile } from "../../api/generated/api.ts"
import type { ChatToolCallPart } from "../../core/threads.ts"
import { useCallback, useEffect, useState } from "react"
import { Button } from "@/widget/components/ui/button"
import { Marker, MarkerContent, MarkerIcon } from "@/widget/components/ui/marker"
import { Spinner } from "@/widget/components/ui/spinner"
import { readSandboxArtifact, sandboxRefusal } from "../../core/sandbox.ts"
import type { SandboxArtifact } from "../../core/types.ts"
import { formatByteSize, isSettledToolCall, saveBlob } from "../lib/utils.ts"

function artifactBasename(path: string): string {
  const index = path.lastIndexOf("/")
  return index === -1 ? path : path.slice(index + 1)
}

async function downloadArtifact(
  artifact: SandboxArtifact,
  getFile: () => Promise<Blob>,
): Promise<boolean> {
  try {
    saveBlob(artifactBasename(artifact.path), await getFile())
    return true
  } catch {
    return false
  }
}

/** Inline preview for an image artifact, fetched once through its authorized download into an object URL. */
function ArtifactImage({
  artifact,
  getFile,
}: {
  artifact: SandboxArtifact
  getFile: () => Promise<Blob>
}) {
  const [objectUrl, setObjectUrl] = useState<string | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  // A failed download replaces the preview with the recovery message.
  const download = () => {
    void downloadArtifact(artifact, getFile).then((ok) => {
      if (!ok) setFailed(true)
    })
  }
  useEffect(() => {
    let revoked: string | undefined
    let cancelled = false
    void (async () => {
      try {
        const url = URL.createObjectURL(await getFile())
        if (cancelled) {
          URL.revokeObjectURL(url)
          return
        }
        revoked = url
        setObjectUrl(url)
      } catch {
        if (!cancelled) setFailed(true)
      }
    })()
    return () => {
      cancelled = true
      if (revoked) URL.revokeObjectURL(revoked)
    }
  }, [getFile])
  if (failed) {
    return <ArtifactExpired label={artifact.label} />
  }
  if (!objectUrl) {
    return (
      <Marker role="status">
        <MarkerIcon>
          <Spinner />
        </MarkerIcon>
        <MarkerContent className="shimmer">
          Loading <span className="font-mono">{artifact.label}</span>
        </MarkerContent>
      </Marker>
    )
  }
  return (
    <figure className="my-1 flex max-w-full flex-col gap-1">
      <img
        src={objectUrl}
        alt={artifact.label}
        className="max-h-80 w-fit max-w-full rounded-md border object-contain"
      />
      <figcaption className="flex items-center gap-1 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1 truncate font-mono">{artifact.label}</span>
        {formatByteSize(artifact.size)}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Download ${artifact.label}`}
          title="Download"
          onClick={download}
        >
          <DownloadSimpleIcon />
        </Button>
      </figcaption>
    </figure>
  )
}

function ArtifactExpired({ label }: { label: string }) {
  return (
    <Marker>
      <MarkerIcon>
        <WarningCircleIcon />
      </MarkerIcon>
      <MarkerContent>
        <span className="font-mono">{label}</span> is no longer available; ask the agent to publish
        it again.
      </MarkerContent>
    </Marker>
  )
}

/**
 * A `sandbox_publish_artifact` call in the transcript: an image renders inline with a download,
 * anything else is a download row. Stored files use current conversation authorization.
 */
export function SandboxArtifactPart({
  part,
  apiUrl,
  getAttachment,
  getUploadedFile,
}: {
  part: ChatToolCallPart
  apiUrl: string
  getAttachment?: ((messageId: string, partId: string) => Promise<Blob>) | undefined
  getUploadedFile?: ((id: string) => Promise<Blob>) | undefined
}) {
  // Unavailable downloads replace the row with the recovery message.
  const [downloadFailed, setDownloadFailed] = useState(false)
  const artifact = readSandboxArtifact(part)
  const fileId = artifact?.fileId
  const ticket = artifact?.ticket
  const getFile = useCallback(async () => {
    if (fileId && getUploadedFile) return getUploadedFile(fileId)
    if (fileId && getAttachment && part.artifactMessageId && part.artifactPartId)
      return getAttachment(part.artifactMessageId, part.artifactPartId)
    if (ticket) return (await getChatFile({ ticket }, { apiUrl })).blob()
    throw new Error("File unavailable")
  }, [
    fileId,
    ticket,
    getAttachment,
    getUploadedFile,
    part.artifactMessageId,
    part.artifactPartId,
    apiUrl,
  ])
  const refusal = sandboxRefusal(part)
  const failed = part.state === "error" || refusal !== undefined
  if (failed) {
    return (
      <Marker>
        <MarkerIcon>
          <WarningCircleIcon />
        </MarkerIcon>
        <MarkerContent>
          Could not share <span className="font-mono">{artifact?.label || "the file"}</span>
          {refusal && <span className="block text-muted-foreground">{refusal}</span>}
        </MarkerContent>
      </Marker>
    )
  }
  if (artifact?.unavailable) return <ArtifactExpired label={artifact.label} />
  if (!artifact?.published) {
    return (
      <Marker role={isSettledToolCall(part) ? undefined : "status"}>
        <MarkerIcon>
          <Spinner />
        </MarkerIcon>
        <MarkerContent className="shimmer">
          Sharing {artifact?.label ? <span className="font-mono">{artifact.label}</span> : "a file"}
        </MarkerContent>
      </Marker>
    )
  }
  if (downloadFailed) {
    return <ArtifactExpired label={artifact.label} />
  }
  if (artifact.mimeType?.startsWith("image/")) {
    return <ArtifactImage artifact={artifact} getFile={getFile} />
  }
  return (
    <div className="flex w-fit max-w-full items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
      <FileArrowDownIcon className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate font-mono">{artifact.label}</span>
      {formatByteSize(artifact.size) && (
        <span className="shrink-0 text-xs text-muted-foreground">
          {formatByteSize(artifact.size)}
        </span>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Download ${artifact.label}`}
        title="Download"
        onClick={() => {
          void downloadArtifact(artifact, getFile).then((ok) => {
            if (!ok) setDownloadFailed(true)
          })
        }}
      >
        <DownloadSimpleIcon />
      </Button>
    </div>
  )
}
