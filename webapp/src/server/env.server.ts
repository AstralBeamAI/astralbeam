import process from "node:process"

import { Schema } from "effect"

const nonEmptyString = Schema.String.pipe(
  Schema.check(Schema.isTrimmed()),
  Schema.check(Schema.isMinLength(1)),
)

const secret = nonEmptyString.pipe(Schema.check(Schema.isMinLength(32)))

const absoluteUrl = nonEmptyString.pipe(
  Schema.check(
    Schema.makeFilter((value) => {
      try {
        return ["http:", "https:"].includes(new URL(value).protocol)
      } catch {
        return false
      }
    }, { message: "Expected an absolute HTTP(S) URL" }),
  ),
)

const serverEnvironmentSchema = Schema.Struct({
  BETTER_AUTH_SECRET: secret,
  BETTER_AUTH_URL: absoluteUrl,
  DATABASE_URL: nonEmptyString,
  GITHUB_CLIENT_ID: nonEmptyString,
  GITHUB_CLIENT_SECRET: nonEmptyString,
  GOOGLE_CLIENT_ID: nonEmptyString,
  GOOGLE_CLIENT_SECRET: nonEmptyString,
})

export type ServerEnvironment = typeof serverEnvironmentSchema.Type

export const parseServerEnvironment = Schema.decodeUnknownSync(serverEnvironmentSchema)

export const serverEnvironment = parseServerEnvironment(process.env)
