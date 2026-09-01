import { DownloadSimpleIcon, FileArrowDownIcon, WarningCircleIcon } from "@phosphor-icons/react"
import type { MessagePart } from "@tanstack/ai-client"
import { useEffect, useState } from "react"
import { Button } from "@/widget/components/ui/button"
import { Marker, MarkerContent, MarkerIcon } from "@/widget/components/ui/marker"
import { Spinner } from "@/widget/components/ui/spinner"
import { readSandboxArtifact, sandboxRefusal } from "../../core/sandbox.ts"
import type { SandboxArtifact } from "../../core/types.ts"
import { formatByteSize, isSettledToolCall, saveBlob } from "../lib/utils.ts"

type ToolCallPart = Extract<MessagePart, { type: "tool-call" }>

function artifactUrl(filesEndpoint: string, ticket: string): string {
  return `${filesEndpoint}?ticket=${encodeURIComponent(ticket)}`
}

function artifactBasename(path: string): string {
  const index = path.lastIndexOf("/")
  return index === -1 ? path : path.slice(index + 1)
}

async function downloadArtifact(
  artifact: SandboxArtifact,
  filesEndpoint: string,
): Promise<boolean> {
  if (!artifact.ticket) return false
  try {
    const response = await fetch(artifactUrl(filesEndpoint, artifact.ticket))
    if (!response.ok) return false
    saveBlob(artifactBasename(artifact.path), await response.blob())
    return true
  } catch {
    return false
  }
}

/** Inline preview for an image artifact, fetched once through its ticket into an object URL. */
function ArtifactImage(
  { artifact, filesEndpoint }: { artifact: SandboxArtifact; filesEndpoint: string },
) {
  const [objectUrl, setObjectUrl] = useState<string | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  // A failed download click means the ticket died after the preview loaded; same recovery.
  const download = () => {
    void downloadArtifact(artifact, filesEndpoint).then((ok) => {
      if (!ok) setFailed(true)
    })
  }
  const ticket = artifact.ticket
  useEffect(() => {
    if (!ticket) return
    let revoked: string | undefined
    let cancelled = false
    void (async () => {
      try {
        const response = await fetch(artifactUrl(filesEndpoint, ticket))
        if (!response.ok) throw new Error(`The artifact request answered ${response.status}`)
        const url = URL.createObjectURL(await response.blob())
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
  }, [ticket, filesEndpoint])
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
        <span className="font-mono">{label}</span>{" "}
        is no longer available; ask the agent to publish it again.
      </MarkerContent>
    </Marker>
  )
}

/**
 * A `sandbox_publish_artifact` call in the transcript: an image renders inline with a download,
 * anything else is a download row. The ticket in the tool output is the whole authorization, so
 * this component never needs the chat token.
 */
export function SandboxArtifactPart(
  { part, filesEndpoint }: { part: ToolCallPart; filesEndpoint: string },
) {
  // Tickets expire; a download that comes back empty-handed swaps the row for the recovery note.
  const [downloadFailed, setDownloadFailed] = useState(false)
  const artifact = readSandboxArtifact(part)
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
  if (downloadFailed) {
    return <ArtifactExpired label={artifact.label} />
  }
  if (artifact.mimeType?.startsWith("image/")) {
    return <ArtifactImage artifact={artifact} filesEndpoint={filesEndpoint} />
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
          void downloadArtifact(artifact, filesEndpoint).then((ok) => {
            if (!ok) setDownloadFailed(true)
          })
        }}
      >
        <DownloadSimpleIcon />
      </Button>
    </div>
  )
}
