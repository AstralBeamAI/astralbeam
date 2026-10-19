import { createContext, useContext, useEffect, useRef, useState } from "react"
import { AttachmentMedia } from "@/widget/components/ui/attachment"
import type { AstralBeamChatCore } from "../../core/session.ts"
import type { AttachmentKind } from "../lib/types.ts"
import { AttachmentKindIcon } from "./attachment-kind-icon.tsx"

export const AttachmentFileContext = createContext<
  | { getThreadAttachment: AstralBeamChatCore["getThreadAttachment"]; threadId: string | undefined }
  | undefined
>(undefined)

export function AttachmentPreview({
  id,
  src,
  title,
  kind,
  mimeType,
}: {
  id?: string | undefined
  src?: string | undefined
  title: string
  kind: AttachmentKind | undefined
  mimeType?: string | undefined
}) {
  const files = useContext(AttachmentFileContext)
  const element = useRef<HTMLDivElement>(null)
  const [preview, setPreview] = useState<{
    id: string
    load: NonNullable<typeof files>
    url: string
  }>()
  const [rejected, setRejected] = useState<string>()
  useEffect(() => {
    if (!id || !files || !element.current) return
    let objectUrl: string | undefined
    let cancelled = false
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        observer.disconnect()
        void files
          .getThreadAttachment(
            { fileId: id, ...(files.threadId ? { threadId: files.threadId } : {}) },
            { preview: true },
          )
          .then((blob) => {
            if (cancelled || !blob.size) return
            objectUrl = URL.createObjectURL(blob)
            setPreview({ id, load: files, url: objectUrl })
          })
          .catch(() => undefined)
      },
      { rootMargin: "200px" },
    )
    observer.observe(element.current)
    return () => {
      cancelled = true
      observer.disconnect()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [id, files])
  const url = preview && preview.id === id && preview.load === files ? preview.url : src
  const thumbnail = url === rejected ? undefined : url
  return (
    <AttachmentMedia ref={element} variant={thumbnail ? "image" : "icon"}>
      {thumbnail ? (
        <img
          key={thumbnail}
          src={thumbnail}
          alt={`Preview of ${title}`}
          onError={() => setRejected(thumbnail)}
        />
      ) : (
        <AttachmentKindIcon kind={kind} mimeType={mimeType} />
      )}
    </AttachmentMedia>
  )
}
