import { FilePdfIcon, FileTextIcon, ImageIcon } from "@phosphor-icons/react"
import type { AttachmentKind } from "../lib/types.ts"

/** The icon standing in for a file, in the composer chip and in the transcript alike. */
export function AttachmentKindIcon({ kind }: { kind: AttachmentKind | undefined }) {
  if (kind === "image") return <ImageIcon />
  if (kind === "pdf") return <FilePdfIcon />
  return <FileTextIcon />
}
