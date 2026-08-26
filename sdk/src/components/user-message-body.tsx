import type { MessagePart, UIMessage } from "@tanstack/ai-client"
import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { describeSentAttachment } from "../lib/attachments.ts"
import { getMessageText } from "../lib/utils.ts"
import { AttachmentKindIcon } from "./attachment-kind-icon.tsx"

type MediaPart = Extract<MessagePart, { type: "image" | "document" }>

function SentAttachment({ part }: { part: MediaPart }) {
  const { kind, title, description, thumbnail } = describeSentAttachment(part)
  return (
    <Attachment size="sm">
      <AttachmentMedia variant={thumbnail ? "image" : "icon"}>
        {thumbnail ? <img src={thumbnail} alt="" /> : <AttachmentKindIcon kind={kind} />}
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>{title}</AttachmentTitle>
        {description && <AttachmentDescription>{description}</AttachmentDescription>}
      </AttachmentContent>
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
