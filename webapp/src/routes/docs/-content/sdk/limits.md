# Limits

The chat endpoint enforces every limit below on every request, whatever the SDK composer already checked. Narrowing a limit through an SDK option is a UX affordance, not a boundary.

## Requests

| Limit                      | Value                                                                         | When it is exceeded                                                              |
| -------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Request body               | 32 MB, checked against `content-length` and again while reading               | `413` — "The message and its attachments are too large."                         |
| Rate limit                 | 20 requests per 60 seconds, counted per organization, tenant, and tenant user | `429` — "Too many chat requests; try again in a minute."                         |
| Chat auth token lifetime   | 60–600 seconds, 300 by default                                                | `createAstralBeamToken` throws; a token outside the range is rejected as invalid |
| Chat auth token size       | 16,384 bytes                                                                  | minting throws, and a longer bearer header is rejected before it is verified     |
| `user` and `tenant` claims | 8,192 bytes of JSON                                                           | minting throws "user and tenant must not exceed 8192 bytes"                      |
| Clock difference           | 30 seconds either way                                                         | the token reads as expired or not yet valid; the composer offers a retry         |

## Attachments

A refused file keeps its chip in the composer, and the agent is told in one sentence that the file could not be included and why.

| Limit                    | Value                                                                                                  | What the agent is told                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Files per message        | 5                                                                                                      | "the message went over the limit of 5 attachments."                                                              |
| One file, by kind        | 5 MB image, 10 MB PDF, 1 MB text, 10 MB data, 10 MB office                                             | "it is larger than the 5.0 MB limit for that file type."                                                         |
| All files on one message | 20 MB                                                                                                  | "the message went over the 20 MB attachment limit."                                                              |
| Accepted types           | PNG, JPEG, WebP, GIF, PDF, text and source files, CSV, TSV, Parquet, SQLite, `.docx`, `.pptx`, `.xlsx` | "this assistant reads images, PDFs, text and source files, CSV and TSV data, Word, Excel, and PowerPoint files." |
| Declared type            | must match the file's leading bytes                                                                    | "its contents are not a `<type>` file."                                                                          |
| Filename                 | 120 characters                                                                                         | truncated with an ellipsis rather than refused                                                                   |

## Files the agent reads

| Limit                      | Value                                                               | What happens at the limit                                                   |
| -------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Office archive             | 96 MB declared uncompressed, 2,048 kept parts, 4,096 entries walked | "it declares more content than this assistant will unpack."                 |
| Table shape                | 50,000 rows, 512 columns, 200,000 cells per sheet                   | cells outside the bounds are skipped and the table is reported as truncated |
| Column type profile        | the first 50 data rows                                              | types stay a hint the agent should confirm against the file itself          |
| Readable text per file     | 2,000,000 characters                                                | `read_attachment` returns `readableTextTruncated: true`                     |
| One `read_attachment` page | 40,000 characters, whatever `limit` asks for                        | the result carries `nextOffset` to read on from                             |

## Sandbox and artifacts

| Limit                    | Value                                                                               | What happens at the limit                                                    |
| ------------------------ | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Idle sandbox             | 15 minutes, swept every minute                                                      | destroyed; the conversation's next turn provisions a new one                 |
| Live sandboxes           | 25 per server process                                                               | the least recently used sandbox is destroyed                                 |
| Published artifact       | 10 MB                                                                               | "Artifacts are limited to 10485760 bytes. Compress or split the file."       |
| Artifact download ticket | 15 minutes                                                                          | `404` — "The download has expired. Ask the agent to publish the file again." |
| Text in the transcript   | 20,000 characters of command output, 40,000 of a file read, 200,000 of a file write | clamped with the middle elided                                               |

Every value here is a constant in the deployment's source, in `webapp/src/lib/chat/constants.server.ts`; none of them is configurable, so a self-hosted deployment changes a limit by editing that file and rebuilding.
