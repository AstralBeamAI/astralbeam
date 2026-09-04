# Attachments

The composer takes files by default: paperclip button, drag and drop, or paste. Images and PDFs go to the model as-is; every other file is delivered as a file the agent reads or analyzes.

## Options

Pass `attachments: false` to turn the feature off, or an object to narrow it.

| Option          | Default                                                              | Meaning                                             |
| --------------- | -------------------------------------------------------------------- | --------------------------------------------------- |
| `enabled`       | `true`                                                               | `false` is the same as `attachments: false`         |
| `maxFiles`      | `5`                                                                  | Files per message                                   |
| `maxFileBytes`  | per kind: 5 MB image, 10 MB PDF, 1 MB text, 10 MB data, 10 MB office | One file; the smaller of this and the kind cap wins |
| `maxTotalBytes` | 20 MB                                                                | All files on one message                            |
| `accept`        | everything supported                                                 | MIME types or `type/*` patterns, e.g. `["image/*"]` |

## Supported files

| Kind     | Formats                                                  | How the agent reads it                             |
| -------- | -------------------------------------------------------- | -------------------------------------------------- |
| `image`  | PNG, JPEG, WebP, GIF                                     | Directly — it is one of the model's own modalities |
| `pdf`    | PDF                                                      | Directly, as a document input                      |
| `text`   | Markdown, JSON, YAML, CSS, HTML, SVG, source files, logs | `read_attachment`, a page at a time                |
| `data`   | CSV, TSV, Parquet, SQLite                                | Column profile up front, then code in the sandbox  |
| `office` | Word (`.docx`), PowerPoint (`.pptx`), Excel (`.xlsx`)    | Extracted text and sheet profiles, then the file   |

## How a file reaches the agent

A file's bytes are never pasted into the conversation. The agent is given a card describing each file, and reaches the contents deliberately.

- The card lists the file's name, type, size, and shape: a table's columns with inferred types and a few sample rows, a deck's slide count.
- `read_attachment` returns the file's text a page at a time, so a long file is fully readable rather than truncated at a cap.
- Agents with a sandbox also get the original file written to `uploads/<name>`, so a spreadsheet can be analyzed with real code rather than read as prose.
- Excel sheets are profiled per sheet and read as CSV, with dates rendered as dates rather than serial numbers.
- Parquet files and SQLite databases have no text view, so they need an agent with a sandbox; without one the file is refused with an explanation.
- A file that cannot be sent keeps its chip in the composer and says why, instead of vanishing.
- The endpoint enforces the same limits independently, so narrowing them here is an affordance, not a boundary.
- Attachments are agent policy: when the dashboard disables them, the endpoint refuses files and the widget hides the attach button; see [Security model](./security.md).
