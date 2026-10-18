import { createContext, useContext, useEffect, useRef, useState } from "react"
import { AttachmentMedia } from "@/widget/components/ui/attachment"
import type { AttachmentKind } from "../lib/types.ts"
import { AttachmentKindIcon } from "./attachment-kind-icon.tsx"

type GetPreview = (messageId: string | undefined, id: string) => Promise<Blob>
export const AttachmentPreviewContext = createContext<GetPreview | undefined>(undefined)

export function AttachmentPreview({
  id,
  messageId,
  src,
  title,
  kind,
  mimeType,
}: {
  id?: string | undefined
  messageId?: string | undefined
  src?: string | undefined
  title: string
  kind: AttachmentKind | undefined
  mimeType?: string | undefined
}) {
  const getPreview = useContext(AttachmentPreviewContext)
  const element = useRef<HTMLDivElement>(null)
  const [preview, setPreview] = useState<{
    id: string
    messageId: string | undefined
    load: GetPreview
    url: string
  }>()
  const [rejected, setRejected] = useState<string>()
  useEffect(() => {
    if (!id || !getPreview || !element.current) return
    let objectUrl: string | undefined
    let cancelled = false
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        observer.disconnect()
        void getPreview(messageId, id)
          .then((blob) => {
            if (cancelled || !blob.size) return
            objectUrl = URL.createObjectURL(blob)
            setPreview({ id, messageId, load: getPreview, url: objectUrl })
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
  }, [id, messageId, getPreview])
  const url =
    preview && preview.id === id && preview.messageId === messageId && preview.load === getPreview
      ? preview.url
      : src
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
