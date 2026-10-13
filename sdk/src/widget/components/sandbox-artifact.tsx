import { DownloadSimpleIcon, FileArrowDownIcon, WarningCircleIcon } from "@phosphor-icons/react"
import type { ChatToolCallPart } from "../../core/threads.ts"
import { useCallback, useEffect, useState } from "react"
import { Button } from "@/widget/components/ui/button"
import { Marker, MarkerContent, MarkerIcon } from "@/widget/components/ui/marker"
import { Spinner } from "@/widget/components/ui/spinner"
import { readSandboxArtifact, sandboxRefusal } from "../../core/sandbox.ts"
import { formatByteSize, isSettledToolCall, saveBlob } from "../lib/utils.ts"

// Published images render inline, other files as download rows. Both use current conversation access.
export function SandboxArtifactPart({
  part,
  getFile: readFile,
  getAttachment,
}: {
  part: ChatToolCallPart
  getFile?: ((id: string) => Promise<Blob>) | undefined
  getAttachment: (messageId: string, partId: string) => Promise<Blob>
}) {
  const [failedDownload, setFailedDownload] = useState(false)
  const [objectUrl, setObjectUrl] = useState<string>()
  const artifact = readSandboxArtifact(part)
  const { artifactMessageId, artifactPartId } = part
  const fileId = artifact?.fileId
  const getFile = useCallback(() => {
    if (artifactMessageId && artifactPartId) return getAttachment(artifactMessageId, artifactPartId)
    if (fileId && readFile) return readFile(fileId)
    return Promise.reject(new Error("File unavailable"))
  }, [artifactMessageId, artifactPartId, fileId, getAttachment, readFile])
  const isImage = artifact?.published && artifact.mimeType?.startsWith("image/")
  useEffect(() => {
    if (!isImage) return
    let url: string | undefined
    let cancelled = false
    void getFile()
      .then((blob) => {
        if (cancelled) return
        url = URL.createObjectURL(blob)
        setObjectUrl(url)
      })
      .catch(() => {
        if (!cancelled) setFailedDownload(true)
      })
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [getFile, isImage])
  const download = async () => {
    try {
      saveBlob(artifact?.path.split("/").at(-1) || "artifact", await getFile())
    } catch {
      setFailedDownload(true)
    }
  }
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
  if (failedDownload) {
    return (
      <Marker>
        <MarkerIcon>
          <WarningCircleIcon />
        </MarkerIcon>
        <MarkerContent>
          <span className="font-mono">{artifact.label}</span> is no longer available. Ask the agent
          to publish it again.
        </MarkerContent>
      </Marker>
    )
  }
  if (isImage && !objectUrl) {
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
  const downloadButton = (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={`Download ${artifact.label}`}
      title="Download"
      onClick={() => void download()}
    >
      <DownloadSimpleIcon />
    </Button>
  )
  if (isImage) {
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
          {downloadButton}
        </figcaption>
      </figure>
    )
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
      {downloadButton}
    </div>
  )
}
