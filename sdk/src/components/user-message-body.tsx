import { FileTextIcon } from "@phosphor-icons/react"
import type { UIMessage } from "@tanstack/ai-client"
import {
  Attachment,
  AttachmentContent,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { getMessageText } from "../lib/utils.ts"

export function UserMessageBody({ message }: { message: UIMessage }) {
  const text = getMessageText(message)
  return (
    <>
      {text.length > 0 && (
        <Bubble>
          <BubbleContent>{text}</BubbleContent>
        </Bubble>
      )}
      {message.parts.map((part, partIndex) => {
        if (part.type !== "document" && part.type !== "image") return null
        const url = part.source.type === "url" ? part.source.value : null
        // TanStack media parts carry no filename, so fall back to the URL basename.
        const title = url?.split("/").at(-1) ?? "Attachment"
        return (
          <Attachment key={partIndex}>
            <AttachmentMedia>
              <FileTextIcon />
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle>{title}</AttachmentTitle>
            </AttachmentContent>
          </Attachment>
        )
      })}
    </>
  )
}
