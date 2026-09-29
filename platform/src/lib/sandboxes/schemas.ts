import * as Data from "effect/Data"
import * as Schema from "effect/Schema"

import { strictParseOptions, NonEmptyStringSchema, enumSchema } from "../schemas.ts"

export const SANDBOX_PROVIDER_IDS = ["daytona", "docker", "sprites", "vercel"] as const

export const SandboxProviderIdSchema = enumSchema(SANDBOX_PROVIDER_IDS)
export type SandboxProviderId = typeof SandboxProviderIdSchema.Type

const secretString = NonEmptyStringSchema.pipe(
  Schema.check(Schema.isTrimmed()),
  Schema.check(Schema.isMaxLength(16_384)),
)

const nonEmptyTrimmedString = NonEmptyStringSchema.pipe(
  Schema.check(Schema.isTrimmed()),
  Schema.check(Schema.isMaxLength(256)),
)

export const SandboxProviderNameSchema = NonEmptyStringSchema.pipe(
  Schema.check(Schema.isTrimmed()),
  Schema.check(Schema.isMaxLength(100)),
)

const DaytonaSandboxOptionsSchema = Schema.Struct({
  target: enumSchema(["us", "eu"]),
  snapshot: nonEmptyTrimmedString,
})
const DaytonaSandboxCredentialsSchema = Schema.Struct({ apiKey: secretString })

const DockerSandboxOptionsSchema = Schema.Struct({ image: nonEmptyTrimmedString })
const EmptySandboxConfigurationSchema = Schema.Record(
  Schema.String,
  Schema.Never.annotate({ message: "This field is not allowed" }),
)
const DockerSandboxCredentialsSchema = EmptySandboxConfigurationSchema
const SpritesSandboxOptionsSchema = EmptySandboxConfigurationSchema
const SpritesSandboxCredentialsSchema = Schema.Struct({ apiKey: secretString })
const VercelSandboxOptionsSchema = Schema.Struct({
  teamId: nonEmptyTrimmedString,
  projectId: nonEmptyTrimmedString,
  runtime: enumSchema(["node24", "node22", "python3.13"]),
})
const VercelSandboxCredentialsSchema = Schema.Struct({ token: secretString })

const SANDBOX_PROVIDER_SCHEMAS = {
  daytona: { options: DaytonaSandboxOptionsSchema, credentials: DaytonaSandboxCredentialsSchema },
  docker: { options: DockerSandboxOptionsSchema, credentials: DockerSandboxCredentialsSchema },
  sprites: { options: SpritesSandboxOptionsSchema, credentials: SpritesSandboxCredentialsSchema },
  vercel: { options: VercelSandboxOptionsSchema, credentials: VercelSandboxCredentialsSchema },
} as const

export type SandboxProviderOptions = {
  [Provider in SandboxProviderId]: (typeof SANDBOX_PROVIDER_SCHEMAS)[Provider]["options"]["Type"]
}

export type SandboxProviderCredentials = {
  [
    Provider in SandboxProviderId
  ]: (typeof SANDBOX_PROVIDER_SCHEMAS)[Provider]["credentials"]["Type"]
}

const sandboxProviderSchemas: {
  [Provider in SandboxProviderId]: {
    options: Schema.Decoder<SandboxProviderOptions[Provider]>
    credentials: Schema.Decoder<SandboxProviderCredentials[Provider]>
  }
} = SANDBOX_PROVIDER_SCHEMAS

export const SandboxProviderConfigurationSchema = Schema.Union([
  Schema.Struct({ providerType: Schema.Literal("daytona"), ...SANDBOX_PROVIDER_SCHEMAS.daytona }),
  Schema.Struct({ providerType: Schema.Literal("docker"), ...SANDBOX_PROVIDER_SCHEMAS.docker }),
  Schema.Struct({ providerType: Schema.Literal("sprites"), ...SANDBOX_PROVIDER_SCHEMAS.sprites }),
  Schema.Struct({ providerType: Schema.Literal("vercel"), ...SANDBOX_PROVIDER_SCHEMAS.vercel }),
])

export const SandboxProviderOptionsSchema = Schema.Union(
  SANDBOX_PROVIDER_IDS.map((provider) => SANDBOX_PROVIDER_SCHEMAS[provider].options),
)
export const SandboxProviderCredentialsSchema = Schema.Union(
  SANDBOX_PROVIDER_IDS.map((provider) => SANDBOX_PROVIDER_SCHEMAS[provider].credentials),
)

const SANDBOX_CONNECTION_ERROR_CODES = [
  "cancelled",
  "timeout",
  "authentication",
  "quota",
  "not_found",
  "provider_error",
  "cleanup_failed",
] as const
export type SandboxConnectionErrorCode = (typeof SANDBOX_CONNECTION_ERROR_CODES)[number]

const SandboxConnectionErrorCodeSchema = enumSchema(SANDBOX_CONNECTION_ERROR_CODES)
const SandboxTestedAtSchema = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value) => {
      const parsed = new Date(value)
      return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value
    }),
  ),
)
export const SandboxTestMetadataSchema = Schema.Struct({
  status: enumSchema(["success", "failure"]),
  testedAt: SandboxTestedAtSchema,
  errorCode: Schema.optionalKey(SandboxConnectionErrorCodeSchema),
})

export type SandboxTestMetadata = typeof SandboxTestMetadataSchema.Type

export function decodeProviderOptions<Provider extends SandboxProviderId>(
  provider: Provider,
  value: unknown,
): SandboxProviderOptions[Provider] {
  return decodeStrict(sandboxProviderSchemas[provider].options, value)
}

export function decodeProviderCredentials<Provider extends SandboxProviderId>(
  provider: Provider,
  value: unknown,
): SandboxProviderCredentials[Provider] {
  return decodeStrict(sandboxProviderSchemas[provider].credentials, value)
}

export function isProviderCredentials<Provider extends SandboxProviderId>(
  provider: Provider,
  value: unknown,
): value is SandboxProviderCredentials[Provider] {
  return Schema.is(SANDBOX_PROVIDER_SCHEMAS[provider].credentials)(value)
}

function decodeStrict<A>(schema: Schema.Decoder<A>, value: unknown): A {
  try {
    return Schema.decodeUnknownSync(schema, strictParseOptions)(value)
  } catch (error) {
    if (!Schema.isSchemaError(error)) throw error
    throw new SandboxConfigurationValidationError(error.message)
  }
}

export class SandboxConfigurationValidationError extends Data.TaggedError(
  "SandboxConfigurationValidationError",
)<{
  readonly message: string
}> {
  constructor(input: string | { readonly message: string }) {
    super(typeof input === "string" ? { message: input } : input)
  }
}
