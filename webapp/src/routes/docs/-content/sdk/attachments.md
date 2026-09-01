# Attachments

The composer takes files by default: paperclip button, drag and drop, or paste. Images and PDFs go to the model as-is; text files, including source files, are read as text by the endpoint.

## Options

Pass `attachments: false` to turn the feature off, or an object to narrow it.

| Option          | Default                                    | Meaning                                             |
| --------------- | ------------------------------------------ | --------------------------------------------------- |
| `enabled`       | `true`                                     | `false` is the same as `attachments: false`         |
| `maxFiles`      | `5`                                        | Files per message                                   |
| `maxFileBytes`  | per kind: 5 MB image, 10 MB PDF, 1 MB text | One file; the smaller of this and the kind cap wins |
| `maxTotalBytes` | 20 MB                                      | All files on one message                            |
| `accept`        | everything supported                       | MIME types or `type/*` patterns, e.g. `["image/*"]` |

## Behavior

- Supported kinds: PNG, JPEG, WebP, and GIF images; PDFs; text files.
- A file that cannot be sent keeps its chip and says why, instead of vanishing.
- Files are sent ahead of the text so the agent reads the question with them in context.
- A file still being read blocks the send rather than being left behind.
- The endpoint enforces the same limits independently, so narrowing them here is an affordance, not a boundary.
