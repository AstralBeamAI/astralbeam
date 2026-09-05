import {
  FileDocIcon,
  FilePdfIcon,
  FilePptIcon,
  FileTextIcon,
  FileXlsIcon,
  ImageIcon,
  TableIcon,
} from "@phosphor-icons/react"
import {
  ATTACHMENT_DOCX_MIME_TYPE,
  ATTACHMENT_PPTX_MIME_TYPE,
  ATTACHMENT_XLSX_MIME_TYPE,
} from "../lib/constants.ts"
import type { AttachmentKind } from "../lib/types.ts"

/** Office files share one kind but not one icon: a chip should look like the file it holds. */
function OfficeIcon({ mimeType }: { mimeType: string | undefined }) {
  if (mimeType === ATTACHMENT_DOCX_MIME_TYPE) return <FileDocIcon />
  if (mimeType === ATTACHMENT_PPTX_MIME_TYPE) return <FilePptIcon />
  if (mimeType === ATTACHMENT_XLSX_MIME_TYPE) return <FileXlsIcon />
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
