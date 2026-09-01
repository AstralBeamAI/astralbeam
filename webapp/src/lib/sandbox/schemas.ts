import * as Data from "effect/Data"
import * as Schema from "effect/Schema"

export const SANDBOX_PROVIDER_IDS = ["daytona", "docker", "sprites", "vercel"] as const

export const SandboxProviderIdSchema = Schema.Literals(SANDBOX_PROVIDER_IDS)
export type SandboxProviderId = typeof SandboxProviderIdSchema.Type

const secretString = Schema.String.pipe(
  Schema.check(Schema.isTrimmed()),
  Schema.check(Schema.isMinLength(1)),
  Schema.check(Schema.isMaxLength(16_384)),
)

const nonEmptyTrimmedString = Schema.String.pipe(
  Schema.check(Schema.isTrimmed()),
  Schema.check(Schema.isMinLength(1)),
  Schema.check(Schema.isMaxLength(256)),
)

export const SandboxProviderNameSchema = Schema.String.pipe(
  Schema.check(Schema.isTrimmed()),
  Schema.check(Schema.isMinLength(1)),
  Schema.check(Schema.isMaxLength(100)),
)

const DaytonaSandboxOptionsSchema = Schema.Struct({
  target: Schema.Literals(["us", "eu"]),
  snapshot: nonEmptyTrimmedString,
})
const DaytonaSandboxCredentialsSchema = Schema.Struct({ apiKey: secretString })

const DockerSandboxOptionsSchema = Schema.Struct({ image: nonEmptyTrimmedString })
const EmptySandboxConfigurationSchema = Schema.Record(Schema.String, Schema.Never)
const DockerSandboxCredentialsSchema = EmptySandboxConfigurationSchema
const SpritesSandboxOptionsSchema = EmptySandboxConfigurationSchema
const SpritesSandboxCredentialsSchema = Schema.Struct({ apiKey: secretString })
const VercelSandboxOptionsSchema = Schema.Struct({
  teamId: nonEmptyTrimmedString,
  projectId: nonEmptyTrimmedString,
  runtime: Schema.Literals(["node24", "node22", "python3.13"]),
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
  [Provider in SandboxProviderId]:
    (typeof SANDBOX_PROVIDER_SCHEMAS)[Provider]["credentials"]["Type"]
}

const sandboxProviderOptionDecoders: {
  [Provider in SandboxProviderId]: (
    value: unknown,
    message: string,
  ) => SandboxProviderOptions[Provider]
} = {
  daytona: (value, message) => decodeStrict(DaytonaSandboxOptionsSchema, value, message),
  docker: (value, message) => decodeStrict(DockerSandboxOptionsSchema, value, message),
  sprites: (value, message) => decodeStrict(SpritesSandboxOptionsSchema, value, message),
  vercel: (value, message) => decodeStrict(VercelSandboxOptionsSchema, value, message),
}

const sandboxProviderCredentialDecoders: {
  [Provider in SandboxProviderId]: (
    value: unknown,
    message: string,
  ) => SandboxProviderCredentials[Provider]
} = {
  daytona: (value, message) => decodeStrict(DaytonaSandboxCredentialsSchema, value, message),
  docker: (value, message) => decodeStrict(DockerSandboxCredentialsSchema, value, message),
  sprites: (value, message) => decodeStrict(SpritesSandboxCredentialsSchema, value, message),
  vercel: (value, message) => decodeStrict(VercelSandboxCredentialsSchema, value, message),
}

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

const SandboxConnectionErrorCodeSchema = Schema.Literals(SANDBOX_CONNECTION_ERROR_CODES)
const SandboxTestedAtSchema = Schema.String.pipe(
  Schema.check(Schema.makeFilter((value) => {
    const parsed = new Date(value)
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value
  })),
)
export const SandboxTestMetadataSchema = Schema.Struct({
  status: Schema.Literals(["success", "failure"]),
  testedAt: SandboxTestedAtSchema,
  errorCode: Schema.optionalKey(SandboxConnectionErrorCodeSchema),
})

export type SandboxTestMetadata = typeof SandboxTestMetadataSchema.Type

export function decodeProviderOptions<Provider extends SandboxProviderId>(
  provider: Provider,
  value: unknown,
): SandboxProviderOptions[Provider] {
  return sandboxProviderOptionDecoders[provider](
    value,
    `Invalid ${provider} sandbox settings`,
  )
}

export function decodeProviderCredentials<Provider extends SandboxProviderId>(
  provider: Provider,
  value: unknown,
): SandboxProviderCredentials[Provider] {
  return sandboxProviderCredentialDecoders[provider](
    value,
    `Invalid ${provider} sandbox credentials`,
  )
}

export function isProviderCredentials<Provider extends SandboxProviderId>(
  provider: Provider,
  value: unknown,
): value is SandboxProviderCredentials[Provider] {
  return Schema.is(SANDBOX_PROVIDER_SCHEMAS[provider].credentials)(value)
}

function decodeStrict<A>(schema: Schema.Codec<A, unknown>, value: unknown, message: string): A {
  try {
    return Schema.decodeUnknownSync(schema, { onExcessProperty: "error" })(value)
  } catch (error) {
    if (!Schema.isSchemaError(error)) throw error
    throw new SandboxConfigurationValidationError(message)
  }
}

export class SandboxConfigurationValidationError
  extends Data.TaggedError("SandboxConfigurationValidationError")<{
    readonly message: string
  }> {
  constructor(input: string | { readonly message: string }) {
    super(typeof input === "string" ? { message: input } : input)
  }
}
