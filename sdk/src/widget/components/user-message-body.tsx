import type { MessagePart, UIMessage } from "@tanstack/ai-client"
import { useCallback, useEffect, useRef, useState } from "react"
import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@/widget/components/ui/attachment"
import { Bubble, BubbleContent } from "@/widget/components/ui/bubble"
import { describeSentAttachment } from "../lib/attachments.ts"
import { getMessageText, saveBlob } from "../lib/utils.ts"
import { AttachmentKindIcon } from "./attachment-kind-icon.tsx"

type MediaPart = Extract<MessagePart, { type: "image" | "document" | "audio" | "video" }>
type GetAttachment = (messageId: string, partId: string) => Promise<Blob>

export function SentAttachment({
  part,
  messageId,
  getAttachment,
  getUploadedFile,
}: {
  part: MediaPart
  messageId: string
  getAttachment: GetAttachment
  getUploadedFile?: ((id: string) => Promise<Blob>) | undefined
}) {
  const { kind, title, description, href } = describeSentAttachment(part)
  const attachmentId = (part as MediaPart & { savedAttachmentId?: string }).savedAttachmentId
  const fileId =
    part.source.type === "file" && part.source.provider === "astralbeam"
      ? part.source.value
      : undefined
  const hasDownload = !!attachmentId || (!!fileId && !!getUploadedFile)
  const fetchFile = useCallback(() => {
    if (fileId && getUploadedFile) return getUploadedFile(fileId)
    if (attachmentId) return getAttachment(messageId, attachmentId)
    return Promise.reject(new Error("File unavailable"))
  }, [attachmentId, fileId, getAttachment, getUploadedFile, messageId])
  const element = useRef<HTMLDivElement>(null)
  const [preview, setPreview] = useState<string>()
  const [failed, setFailed] = useState(false)
  const [downloading, setDownloading] = useState(false)
  useEffect(() => {
    if (kind !== "image" || !hasDownload || !element.current) return
    let objectUrl: string | undefined
    let cancelled = false
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        observer.disconnect()
        void fetchFile()
          .then((blob) => {
            if (cancelled) return
            objectUrl = URL.createObjectURL(blob)
            setPreview(objectUrl)
          })
          .catch(() => {
            if (!cancelled) setFailed(true)
          })
      },
      { rootMargin: "200px" },
    )
    observer.observe(element.current)
    return () => {
      cancelled = true
      observer.disconnect()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [fetchFile, hasDownload, kind])
  const download = async () => {
    if (!hasDownload) return
    setDownloading(true)
    try {
      saveBlob(title, await fetchFile())
      setFailed(false)
    } catch {
      setFailed(true)
    } finally {
      setDownloading(false)
    }
  }
  const thumbnail = kind === "image" ? (preview ?? href) : undefined
  return (
    <div ref={element} className="max-w-full">
      <Attachment size="sm" state={failed ? "error" : downloading ? "processing" : "done"}>
        <AttachmentMedia variant={thumbnail ? "image" : "icon"}>
          {thumbnail ? (
            <img src={thumbnail} alt="" />
          ) : (
            <AttachmentKindIcon kind={kind} mimeType={part.source.mimeType} />
          )}
        </AttachmentMedia>
        <AttachmentContent>
          <AttachmentTitle>{title}</AttachmentTitle>
          {(failed || description) && (
            <AttachmentDescription>
              {failed ? "File unavailable. Try again." : description}
            </AttachmentDescription>
          )}
        </AttachmentContent>
        {hasDownload ? (
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
                rel="noreferrer"
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

export function UserMessageBody({
  message,
  getAttachment,
  getUploadedFile,
}: {
  message: UIMessage
  getAttachment: GetAttachment
  getUploadedFile?: ((id: string) => Promise<Blob>) | undefined
}) {
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
            <SentAttachment
              key={partIndex}
              part={part}
              messageId={message.id}
              getAttachment={getAttachment}
              getUploadedFile={getUploadedFile}
            />
          ))}
        </div>
      )}
      {text.length > 0 && (
        <Bubble>
          <BubbleContent>
            <span className="whitespace-pre-wrap">{text}</span>
          </BubbleContent>
        </Bubble>
      )}
    </>
  )
}
