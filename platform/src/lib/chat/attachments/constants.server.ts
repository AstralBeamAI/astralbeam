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

// The readable text view of a file, held for the run so `read_attachment` can page through it.
// This is a memory bound, not a context bound: what reaches the model is one page at a time.
export const CHAT_ATTACHMENT_MAX_TEXT_CHARACTERS = 2_000_000
export const CHAT_ATTACHMENT_READ_MAX_CHARACTERS = 40_000

// Column types are inferred from the leading rows rather than the whole file, which bounds the
// work per column and is why a profile is a hint the agent should confirm in code.
export const CHAT_ATTACHMENT_PROFILE_TYPED_ROWS = 50

// Declared ZIP sizes are attacker-chosen and `unzipSync` inflates every selected entry, so one
// archive-wide budget bounds both a single bomb and many modest entries.
export const CHAT_ATTACHMENT_MAX_OFFICE_ARCHIVE_BYTES = 96 * 1024 * 1024
export const CHAT_ATTACHMENT_MAX_OFFICE_ENTRIES = 2_048
// `filter` runs for every declared entry, so the caps above bound only the entries that are kept.
// This bounds the walk itself, well above the few hundred parts a real deck or workbook holds.
export const CHAT_ATTACHMENT_MAX_OFFICE_VISITED_ENTRIES = 4_096

// One worksheet value at `XFD1048576` describes a 17-billion-cell grid and a delimited file can
// be one 10 MB row, so table shape is bounded before anything is allocated from it.
export const CHAT_ATTACHMENT_MAX_SHEET_CELLS = 200_000
export const CHAT_ATTACHMENT_MAX_TABLE_ROWS = 50_000
export const CHAT_ATTACHMENT_MAX_TABLE_COLUMNS = 512

/** Where attached files land in the sandbox, relative to its workspace directory. */
export const CHAT_ATTACHMENT_UPLOAD_DIRECTORY = "uploads"

/** Image types the configured model reads natively. Anything else is refused with a reason. */
export const CHAT_ATTACHMENT_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]

/** The only document type the provider takes as a file. Everything else is read here. */
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

/** Delimited text: read as text, and profiled as a table because that is what it is. */
export const CHAT_ATTACHMENT_DELIMITED_MIME_TYPES = [
  "text/csv",
  "text/tab-separated-values",
  "application/csv",
]

/** Data files with no text view at all, so only the sandbox can open them. */
export const CHAT_ATTACHMENT_OPAQUE_DATA_MIME_TYPES = [
  "application/vnd.apache.parquet",
  "application/x-parquet",
  "application/vnd.sqlite3",
  "application/x-sqlite3",
]

/** The OOXML office formats, which `-lib/attachment-office.server.ts` unpacks. */
export const CHAT_ATTACHMENT_DOCX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
export const CHAT_ATTACHMENT_PPTX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation"
export const CHAT_ATTACHMENT_XLSX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

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

/** Leading bytes each type must start with, so a renamed file is refused with a reason. A type
 * without one, such as delimited text, is validated by decoding. https://www.iana.org/assignments/media-types/media-types.xhtml */
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
