import { EyeIcon, XIcon } from "@phosphor-icons/react"
import { useEffect, useRef } from "react"
import {
  Attachment,
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
import { TooltipButton } from "./tooltip-button.tsx"

// Reading and uploading share the chip's busy state until the server returns a file reference.
const CHIP_STATE = {
  reading: "uploading",
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
}: {
  attachments: readonly DraftAttachment[]
  onRemove: (id: string) => void
}) {
  const group = useRef<HTMLDivElement>(null)
  const newest = attachments.at(-1)?.id
  // The row scrolls rather than wraps, so a file added past the visible width — a rejected one
  // in particular, whose chip is the only place its reason appears — has to be scrolled to.
  useEffect(() => {
    const element = group.current
    if (element) element.scrollLeft = element.scrollWidth
  }, [newest])
  const rejected = attachments.filter((attachment) => attachment.status === "error")
  if (attachments.length === 0) return null
  return (
    <div className="w-full min-w-0">
      {rejected.length > 0 && (
        <div className="mb-2 flex items-center gap-2 text-sm text-destructive">
          <span>
            {rejected.length} {rejected.length === 1 ? "file could" : "files could"} not be
            attached.
          </span>
          <TooltipButton
            type="button"
            variant="ghost"
            size="icon-sm"
            tooltip="Review files"
            onClick={() => {
              const chip = group.current?.querySelector<HTMLElement>('[role="alert"]')
              chip?.scrollIntoView({ block: "nearest", inline: "nearest" })
              chip?.querySelector<HTMLButtonElement>("button")?.focus()
            }}
          >
            <EyeIcon />
          </TooltipButton>
        </div>
      )}
      <AttachmentGroup ref={group} className="w-full">
        {attachments.map((attachment) => {
          const thumbnail =
            attachment.kind === "image" && attachment.data !== undefined
              ? attachmentDataUri(attachment.mimeType, attachment.data)
              : undefined
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
                ) : attachment.status === "reading" ? (
                  <Spinner />
                ) : (
                  <AttachmentKindIcon kind={attachment.kind} mimeType={attachment.mimeType} />
                )}
              </AttachmentMedia>
              <AttachmentContent>
                <AttachmentTitle>{attachment.name}</AttachmentTitle>
                <AttachmentDescription>
                  {attachment.error ?? formatByteSize(attachment.size)}
                </AttachmentDescription>
              </AttachmentContent>
              <AttachmentActions>
                <TooltipButton
                  data-slot="attachment-action"
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Remove ${attachment.name}`}
                  tooltip="Remove attachment"
                  onClick={() => onRemove(attachment.id)}
                >
                  <XIcon />
                </TooltipButton>
              </AttachmentActions>
            </Attachment>
          )
        })}
      </AttachmentGroup>
    </div>
  )
}
