import { createContext, useContext, useEffect, useRef, useState } from "react"
import { AttachmentMedia } from "@/widget/components/ui/attachment"
import type { AstralBeamChatCore } from "../../core/session.ts"
import type { AttachmentKind } from "../lib/types.ts"
import { AttachmentKindIcon } from "./attachment-kind-icon.tsx"

export const AttachmentFileContext = createContext<AstralBeamChatCore["getFile"] | undefined>(
  undefined,
)

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
  const getFile = useContext(AttachmentFileContext)
  const element = useRef<HTMLDivElement>(null)
  const [preview, setPreview] = useState<{
    id: string
    load: AstralBeamChatCore["getFile"]
    url: string
  }>()
  const [rejected, setRejected] = useState<string>()
  useEffect(() => {
    if (!id || !getFile || !element.current) return
    let objectUrl: string | undefined
    let cancelled = false
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        observer.disconnect()
        void getFile([id], { preview: true })
          .then((blob) => {
            if (cancelled || !blob.size) return
            objectUrl = URL.createObjectURL(blob)
            setPreview({ id, load: getFile, url: objectUrl })
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
  }, [id, getFile])
  const url = preview && preview.id === id && preview.load === getFile ? preview.url : src
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
