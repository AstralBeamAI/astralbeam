import type { MessagePart, UIMessage } from "@tanstack/ai-client"
import { useContext, useState } from "react"
import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentTitle,
  AttachmentTrigger,
} from "@/widget/components/ui/attachment"
import { Bubble, BubbleContent } from "@/widget/components/ui/bubble"
import { describeSentAttachment } from "../lib/attachments.ts"
import { getMessageText, saveBlob } from "../lib/utils.ts"
import { AttachmentFileContext, AttachmentPreview } from "./attachment-preview.tsx"

type MediaPart = Extract<MessagePart, { type: "image" | "document" | "audio" | "video" }> & {
  fileId?: string | undefined
}

export function SentAttachment({ part }: { part: MediaPart }) {
  const files = useContext(AttachmentFileContext)
  const { kind, title, description, href } = describeSentAttachment(part)
  const fileId = part.fileId
  const [failed, setFailed] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const download = async () => {
    if (!fileId || !files?.threadId) return
    setDownloading(true)
    try {
      saveBlob(
        title,
        await files.getChatFile({ fileId, threadId: files.threadId, filename: title }),
      )
      setFailed(false)
    } catch {
      setFailed(true)
    } finally {
      setDownloading(false)
    }
  }
  return (
    <div className="max-w-full">
      <Attachment size="sm" state={failed ? "error" : downloading ? "processing" : "done"}>
        <AttachmentPreview
          id={fileId}
          src={kind === "image" ? href : undefined}
          title={title}
          kind={kind}
          mimeType={part.source.mimeType}
        />
        <AttachmentContent>
          <AttachmentTitle title={title}>{title}</AttachmentTitle>
          {(failed || description) && (
            <AttachmentDescription>
              {failed ? "File unavailable. Try again." : description}
            </AttachmentDescription>
          )}
        </AttachmentContent>
        {fileId ? (
          <AttachmentTrigger
            aria-label={`Download ${title}`}
            title={`Download ${title}`}
            disabled={downloading}
            onClick={() => void download()}
          />
        ) : href ? (
          // The trigger covers the whole chip, making it the download control. `download` is
          // honored for the inline `data:` source; a remote one, where browsers ignore it, opens
          // in its own tab rather than navigating the host page away.
          <AttachmentTrigger
            render={
              <a
                href={href}
                download={title}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Download ${title}`}
                title={`Download ${title}`}
              />
            }
          />
        ) : null}
      </Attachment>
    </div>
  )
}

export function UserMessageBody({ message }: { message: UIMessage }) {
  const text = getMessageText(message)
  // Attachments read above the text, as they do in the composer that sent them.
  const media = message.parts.filter((part): part is MediaPart =>
    ["image", "document", "audio", "video"].includes(part.type),
  )
  return (
    <>
      {media.length > 0 && (
        // Wrapped, not the composer's scrolling row: a sent message is read, not edited, so
        // every attachment should be visible without scrolling a narrow sidebar sideways.
        <div className="flex w-full flex-wrap justify-end gap-2">
          {media.map((part, partIndex) => (
            <SentAttachment key={partIndex} part={part} />
          ))}
        </div>
      )}
      {text.length > 0 && (
        <Bubble>
          <BubbleContent className="py-1.5">
            <span className="whitespace-pre-wrap">{text}</span>
          </BubbleContent>
        </Bubble>
      )}
    </>
  )
}
