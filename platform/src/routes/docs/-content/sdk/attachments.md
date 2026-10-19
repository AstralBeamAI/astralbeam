# Attachments

The composer uploads files before sending a message: paperclip button, drag and drop, or paste. Images and PDFs go to the model as-is. Every other file is delivered as a file the agent reads or analyzes.

## Draft recovery

After uploading, local storage keeps file IDs and metadata alongside unsent text. Reloading or reopening restores the draft without sending automatically. File bytes and signed URLs are never saved locally. Clearing storage removes draft references. Uploads do not expire, and files still uploading are not saved yet.

## Options

Pass `attachments: false` to turn the feature off, or an object to narrow it.

| Option | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | `false` is the same as `attachments: false` |
| `maxFiles` | `5` | Files per message |
| `maxFileBytes` | per kind: 5 MB image, 10 MB PDF, 1 MB text, 10 MB data, 10 MB office | One file, the smaller of this and the kind cap wins |
| `maxTotalBytes` | 20 MB | Composer limit per message. The server also caps attachments along the selected conversation path at 20 MB |
| `accept` | everything supported | MIME types or `type/*` patterns, e.g. `["image/*"]` |

## Supported files

| Kind | Formats | How the agent reads it |
| --- | --- | --- |
| `image` | PNG, JPEG, WebP, GIF | Directly, it is one of the model's own modalities |
| `pdf` | PDF | Directly, as a document input |
| `text` | Markdown, JSON, YAML, CSS, HTML, SVG, source files, logs | `read_attachment`, a page at a time |
| `data` | CSV, TSV, Parquet, SQLite | Column profile with the text, then code in the sandbox |
| `office` | Word (`.docx`), PowerPoint (`.pptx`), Excel (`.xlsx`) | Extracted text and sheet profiles, then the file |

## How a file reaches the agent

For files beyond images and PDFs, the message carries a file handle and the agent reads the contents through tools.

- `read_attachment` returns the file's text a page at a time, up to the readable-text cap in [Limits](./limits.md).
- Results include type, size, and table profiles with columns, inferred types, and row counts.
- File contents, names, and table labels remain user input or tool results, never system instructions.
- Agents with a sandbox receive the original file at `uploads/<name>` for analysis with code.
- Excel sheets become CSV and per-sheet profiles. Dates assume the 1900 system and minute precision. Convert 1904-system dates to ISO strings before upload.
- Parquet and SQLite have no text view and require a sandbox. Without one, server admission rejects the message.
- A file that cannot be sent keeps its chip in the composer and says why, instead of vanishing.
- Attachments are agent policy: when the dashboard disables them, the endpoint refuses files and the widget hides the attach button. See [Security model](./security.md).
