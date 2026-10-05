import { Effect, Schema } from "effect"

import {
  SUPPORT_ATTACHMENTS_MAX_BYTES,
  SUPPORT_ATTACHMENTS_MAX_COUNT,
  SUPPORT_MESSAGE_MAX_LENGTH,
} from "./constants.ts"

/** The Contact Support form, with files appended under `attachments[]`. */
export const SupportRequestSchema = Schema.fromFormData(
  Schema.Struct({
    message: Schema.String.check(
      Schema.isPattern(/\S/, { message: "Must not be empty" }),
      Schema.isMaxLength(SUPPORT_MESSAGE_MAX_LENGTH),
    ),
    pagePath: Schema.optionalKey(Schema.String),
    attachments: Schema.Array(Schema.File)
      .check(
        Schema.isMaxLength(SUPPORT_ATTACHMENTS_MAX_COUNT),
        Schema.makeFilter(
          (files) =>
            files.reduce((total, file) => total + file.size, 0) <= SUPPORT_ATTACHMENTS_MAX_BYTES,
          { message: "Attachments must total 10 MB or less" },
        ),
      )
      .pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  }),
)
