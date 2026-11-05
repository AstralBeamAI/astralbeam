// The caps mirror the SDK composer's, which enforces them first, and hold any other client to
// the same numbers here.
export const CHAT_ATTACHMENT_MAX_BYTES_BY_KIND = {
  image: 5 * 1024 * 1024,
  pdf: 10 * 1024 * 1024,
  text: 1024 * 1024,
  data: 10 * 1024 * 1024,
  office: 10 * 1024 * 1024,
} as const
export const CHAT_ATTACHMENT_MAX_TOTAL_BYTES = 20 * 1024 * 1024
// Peer of `MAX_ATTACHMENTS_PER_MESSAGE` in `sdk/src/widget/lib/constants.ts`, which holds a
// message to the same count before it is sent. Keep the two equal.
export const CHAT_ATTACHMENT_MAX_COUNT = 5

export const CHAT_ATTACHMENT_MAX_FILENAME_LENGTH = 120

export const CHAT_ATTACHMENT_READ_MAX_CHARACTERS = 40_000

/** Where attached files land in the sandbox, relative to its workspace directory. */
export const CHAT_ATTACHMENT_UPLOAD_DIRECTORY = "uploads"

/** Image types the configured model reads natively. Anything else is refused with a reason. */
export const CHAT_ATTACHMENT_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]

/** PDF uses the model's native document input. */
export const CHAT_ATTACHMENT_PDF_MIME_TYPE = "application/pdf"

// Textual `application/*` types, since `text/*` is matched by prefix. SVG is markup, so its
// source is more useful to the model than a rejected image would be.
export const CHAT_ATTACHMENT_TEXT_MIME_TYPES = [
  "application/json",
  "application/xml",
  "application/yaml",
  "application/x-yaml",
  "application/toml",
  "application/x-ndjson",
  "application/sql",
  "application/x-sh",
  "application/javascript",
  "application/typescript",
  "image/svg+xml",
]

/** Data files are analyzed from their original bytes in the sandbox. */
export const CHAT_ATTACHMENT_DATA_MIME_TYPES = [
  "text/csv",
  "text/tab-separated-values",
  "application/csv",
  "application/vnd.apache.parquet",
  "application/x-parquet",
  "application/vnd.sqlite3",
  "application/x-sqlite3",
]

/** The OOXML Office formats, interpreted only in the sandbox. */
const CHAT_ATTACHMENT_DOCX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
const CHAT_ATTACHMENT_PPTX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation"
const CHAT_ATTACHMENT_XLSX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

export const CHAT_ATTACHMENT_OFFICE_MIME_TYPES = [
  CHAT_ATTACHMENT_DOCX_MIME_TYPE,
  CHAT_ATTACHMENT_PPTX_MIME_TYPE,
  CHAT_ATTACHMENT_XLSX_MIME_TYPE,
]

/** Types a browser labels badly, repaired from the extension. Only data and office formats are
 * listed, because a mislabeled `.csv` changes delivery while a mislabeled `.md` is text either way. */
export const CHAT_ATTACHMENT_MIME_TYPE_BY_EXTENSION: Record<string, string> = {
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  parquet: "application/vnd.apache.parquet",
  sqlite: "application/vnd.sqlite3",
  sqlite3: "application/vnd.sqlite3",
  db: "application/vnd.sqlite3",
  docx: CHAT_ATTACHMENT_DOCX_MIME_TYPE,
  pptx: CHAT_ATTACHMENT_PPTX_MIME_TYPE,
  xlsx: CHAT_ATTACHMENT_XLSX_MIME_TYPE,
}

/** ZIP local file header, which starts every OOXML office container. */
const ZIP_SIGNATURE = [{ offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04] }]
const PARQUET_SIGNATURE = [{ offset: 0, bytes: [0x50, 0x41, 0x52, 0x31] }]
/** "SQLite format 3\0". */
const SQLITE_SIGNATURE = [{ offset: 0, bytes: [0x53, 0x51, 0x4c, 0x69, 0x74, 0x65] }]

// Check known signatures at admission. CSV and TSV have no signature and stay opaque.
export const CHAT_ATTACHMENT_MAGIC_BYTES: Record<
  string,
  ReadonlyArray<{ offset: number; bytes: readonly number[] }>
> = {
  "image/png": [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47] }],
  "image/jpeg": [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }],
  "image/gif": [{ offset: 0, bytes: [0x47, 0x49, 0x46, 0x38] }],
  // RIFF container with a WEBP tag at offset 8.
  "image/webp": [
    { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
    { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
  ],
  "application/pdf": [{ offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] }],
  [CHAT_ATTACHMENT_DOCX_MIME_TYPE]: ZIP_SIGNATURE,
  [CHAT_ATTACHMENT_PPTX_MIME_TYPE]: ZIP_SIGNATURE,
  [CHAT_ATTACHMENT_XLSX_MIME_TYPE]: ZIP_SIGNATURE,
  "application/vnd.apache.parquet": PARQUET_SIGNATURE,
  "application/x-parquet": PARQUET_SIGNATURE,
  "application/vnd.sqlite3": SQLITE_SIGNATURE,
  "application/x-sqlite3": SQLITE_SIGNATURE,
}
