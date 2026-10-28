# Limits

The server enforces these limits independently of the SDK. Client options can lower them for your interface but cannot raise them. Organization-specific token and spend allowances are configured under [Usage limits](/docs/dashboard/usage-limits).

## Requests

| Limit | Value | When it is exceeded |
| --- | --- | --- |
| Request body | 32 MiB, checked against `content-length` and again while reading | `413`, "The message and its attachments are too large." |
| Request rate | 20 new turns per 60 seconds, counted per organization, tenant, and tenant user | `429`, "Too many chat requests; try again in a minute." |
| Tool-result and upload request rates | 200 requests per 60 seconds each, in separate buckets | `429`, "Too many chat requests; try again in a minute." |
| Usage limits | Token and spend allowances your Organization configures, see [Usage limits](/docs/dashboard/usage-limits) | `429` with a `usage_limit` member naming the limit and when it resets |
| Model turns | 25 per request, each tool round counting as one | the run ends after the last tool result without a final reply |
| Chat auth token lifetime | 60–600 seconds, 300 by default | `createAstralBeamToken` throws, a token outside the range is rejected as invalid |
| Chat auth token size | 16,384 bytes | minting throws, and a longer bearer header is rejected before it is verified |
| `user` and `tenant` claims | 8,192 bytes of JSON | minting throws "user and tenant must not exceed 8192 bytes" |
| Clock difference | 30 seconds either way | the token reads as expired or not yet valid, the composer offers a retry |

## Attachments

A file rejected by the composer never reaches the agent. Server validation can reject the entire message with a generic invalid-conversation error. The draft remains unsent.

| Limit | Value |
| --- | --- |
| Files per message | 5 |
| One file, by kind | 5 MiB image, 10 MiB PDF, 1 MiB text, 10 MiB data, 10 MiB office |
| All files along the selected conversation path | 20 MiB, including the new message |
| Accepted types | PNG, JPEG, WebP, GIF, PDF, text and source files, CSV, TSV, Parquet, SQLite, `.docx`, `.pptx`, `.xlsx` |
| Declared type | Checked against known file signatures. Plain text is validated by decoding |
| Display filename | 120 characters, truncated with an ellipsis |

## Files the agent reads

| Limit | Value | What happens at the limit |
| --- | --- | --- |
| One `read_attachment` page | 40,000 characters, whatever `limit` asks for | the result carries `nextOffset` to read on from |

Paging applies only to plain text files, whose upload limit is 1 MiB. Office and data files, including CSV and TSV, require a sandbox and have no text view through `read_attachment`. Upload admission checks Office file size and signature without inspecting archive contents. Structure and decompression failures surface during sandbox analysis.

## Sandbox and artifacts

| Limit | Value | What happens at the limit |
| --- | --- | --- |
| Idle sandbox | 15 minutes after release, swept every minute | Destroyed only when no run or pending acquisition holds it |
| Live sandboxes | 25 per server process, shared across Organizations | The oldest idle workspace is destroyed. If all are busy, a new workspace is unavailable |
| Published artifact | 10 MiB | "Artifacts are limited to 10485760 bytes. Compress or split the file." |
| Published artifact retention | Until conversation deletion | Downloads check current conversation access |
| Text in the transcript | 20,000 characters of command output, 40,000 of a file read, 200,000 of a file write | clamped with the middle elided |

These limits are enforced by the deployment and cannot be raised through SDK options.
