import {
  FileDocIcon,
  FilePdfIcon,
  FilePptIcon,
  FileTextIcon,
  FileXlsIcon,
  ImageIcon,
  TableIcon,
} from "@phosphor-icons/react"
import { ATTACHMENT_OFFICE_MIME_TYPES } from "../lib/constants.ts"
import type { AttachmentKind } from "../lib/types.ts"

const [DOCX, PPTX, XLSX] = ATTACHMENT_OFFICE_MIME_TYPES

/** Office files share one kind but not one icon: a chip should look like the file it holds. */
function OfficeIcon({ mimeType }: { mimeType: string | undefined }) {
  if (mimeType === DOCX) return <FileDocIcon />
  if (mimeType === PPTX) return <FilePptIcon />
  if (mimeType === XLSX) return <FileXlsIcon />
  return <FileTextIcon />
}

/** The icon standing in for a file, in the composer chip and in the transcript alike. */
export function AttachmentKindIcon(
  { kind, mimeType }: { kind: AttachmentKind | undefined; mimeType?: string | undefined },
) {
  if (kind === "image") return <ImageIcon />
  if (kind === "pdf") return <FilePdfIcon />
  if (kind === "office") return <OfficeIcon mimeType={mimeType} />
  if (kind === "data") return <TableIcon />
  return <FileTextIcon />
}
