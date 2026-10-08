import { XIcon, PauseIcon, PlayIcon } from "@phosphor-icons/react"
import { useEffect, useRef } from "react"
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@/widget/components/ui/attachment"
import { Spinner } from "@/widget/components/ui/spinner"
import { attachmentDataUri } from "../lib/attachments.ts"
import type { DraftAttachment } from "../lib/types.ts"
import { formatByteSize } from "../lib/utils.ts"
import { AttachmentKindIcon } from "./attachment-kind-icon.tsx"

const CHIP_STATE = {
  reading: "uploading",
  uploading: "uploading",
  paused: "idle",
  reselect: "idle",
  ready: "done",
  error: "error",
} as const

/**
 * The picked files above the composer input, rejected ones included: a chip saying why a file
 * cannot be sent is more useful than a file that silently never arrives.
 */
export function ComposerAttachments({
  attachments,
  onRemove,
  onPause,
  onResume,
}: {
  attachments: readonly DraftAttachment[]
  onRemove: (id: string) => void
  onPause: (id: string) => void
  onResume: (id: string) => void
}) {
  const group = useRef<HTMLDivElement>(null)
  const newest = attachments.at(-1)?.id
  // The row scrolls rather than wraps, so a file added past the visible width — a rejected one
  // in particular, whose chip is the only place its reason appears — has to be scrolled to.
  useEffect(() => {
    const element = group.current
    if (element) element.scrollLeft = element.scrollWidth
  }, [newest])
  if (attachments.length === 0) return null
  return (
    <AttachmentGroup ref={group} className="w-full">
      {attachments.map((attachment) => {
        const thumbnail =
          attachment.preview ??
          (attachment.kind === "image" && attachment.data !== undefined
            ? attachmentDataUri(attachment.mimeType, attachment.data)
            : undefined)
        return (
          <Attachment
            key={attachment.id}
            size="sm"
            state={CHIP_STATE[attachment.status]}
            // The reason a file was refused lives only in this chip, so it has to be announced.
            role={attachment.status === "error" ? "alert" : undefined}
          >
            <AttachmentMedia variant={thumbnail ? "image" : "icon"}>
              {thumbnail ? (
                <img src={thumbnail} alt="" />
              ) : attachment.status === "reading" || attachment.status === "uploading" ? (
                <Spinner />
              ) : (
                <AttachmentKindIcon kind={attachment.kind} mimeType={attachment.mimeType} />
              )}
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle>{attachment.name}</AttachmentTitle>
              <AttachmentDescription>
                {attachment.error ??
                  (attachment.status === "uploading"
                    ? `${Math.round((attachment.progress ?? 0) * 100)}% uploaded`
                    : attachment.status === "paused"
                      ? "Paused"
                      : attachment.status === "reselect"
                        ? "Choose the original file to resume"
                        : formatByteSize(attachment.size))}
              </AttachmentDescription>
            </AttachmentContent>
            <AttachmentActions>
              {attachment.status === "uploading" && (
                <AttachmentAction
                  type="button"
                  aria-label={`Pause ${attachment.name}`}
                  onClick={() => onPause(attachment.id)}
                >
                  <PauseIcon />
                </AttachmentAction>
              )}
              {["paused", "reselect", "error"].includes(attachment.status) && attachment.kind && (
                <AttachmentAction
                  type="button"
                  aria-label={`Resume ${attachment.name}`}
                  onClick={() => onResume(attachment.id)}
                >
                  <PlayIcon />
                </AttachmentAction>
              )}
              <AttachmentAction
                type="button"
                aria-label={`Remove ${attachment.name}`}
                title="Remove"
                onClick={() => onRemove(attachment.id)}
              >
                <XIcon />
              </AttachmentAction>
            </AttachmentActions>
          </Attachment>
        )
      })}
    </AttachmentGroup>
  )
}
