import type { MessagePart, UIMessage } from "@tanstack/ai-client"
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
import { getMessageText } from "../lib/utils.ts"
import { AttachmentKindIcon } from "./attachment-kind-icon.tsx"

type MediaPart = Extract<MessagePart, { type: "image" | "document" }>

function SentAttachment({ part }: { part: MediaPart }) {
  const { kind, title, description, href } = describeSentAttachment(part)
  const thumbnail = kind === "image" ? href : undefined
  return (
    <Attachment size="sm">
      <AttachmentMedia variant={thumbnail ? "image" : "icon"}>
        {thumbnail
          ? <img src={thumbnail} alt="" />
          : <AttachmentKindIcon kind={kind} mimeType={part.source.mimeType} />}
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>{title}</AttachmentTitle>
        {description && <AttachmentDescription>{description}</AttachmentDescription>}
      </AttachmentContent>
      {href && (
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
      )}
    </Attachment>
  )
}

export function UserMessageBody({ message }: { message: UIMessage }) {
  const text = getMessageText(message)
  // Attachments read above the text, as they do in the composer that sent them.
  const media = message.parts.filter((part): part is MediaPart =>
    part.type === "image" || part.type === "document"
  )
  return (
    <>
      {media.length > 0 && (
        // Wrapped, not the composer's scrolling row: a sent message is read, not edited, so
        // every attachment should be visible without scrolling a narrow sidebar sideways.
        <div className="flex w-full flex-wrap justify-end gap-2">
          {media.map((part, partIndex) => <SentAttachment key={partIndex} part={part} />)}
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
