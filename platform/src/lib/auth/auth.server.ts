import { API_KEY_ERROR_CODES, apiKey } from "@better-auth/api-key"
import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2"
import type { BetterAuthPlugin } from "better-auth"
import { betterAuth } from "better-auth/minimal"
import {
  addOAuthServerContext,
  APIError,
  createAuthMiddleware,
  createEmailVerificationToken,
  isAPIError,
} from "better-auth/api"
import { captcha, haveIBeenPwned, organization } from "better-auth/plugins"
import { tanstackStartCookies } from "better-auth/tanstack-start"
import { Clock, Context, Effect, Layer, Predicate, Ref } from "effect"

import { getAuthDatabase } from "@/db/database.server"
import { tables } from "@/db/schema.server"
import { ApiKeys } from "@/lib/api-keys/api-keys.server"
import {
  ORGANIZATION_API_KEY_PREFIX,
  ORGANIZATION_API_KEY_RATE_LIMIT_MAX_REQUESTS,
  ORGANIZATION_API_KEY_RATE_LIMIT_WINDOW_MS,
  ORGANIZATION_API_KEY_STARTING_CHARACTERS_LENGTH,
} from "@/lib/api-keys/schemas"
import { Config } from "@/lib/config/config.server"
import type { ConfigValues } from "@/lib/config/types"
import { APP_NAME } from "@/lib/constants"
import { Mailer } from "@/lib/email/email.server"
import { organizationAccessControl, organizationRoles } from "@/lib/organizations/access"
import { OrganizationSlugTaken, SignInRequired } from "@/lib/organizations/errors"
import {
  organizationApiKeyPlugin,
  organizationProvisioningHooks,
  organizationRoleHooks,
} from "@/lib/organizations/hooks.server"
import { forkAppEffect, runAppEffect } from "@/lib/runtime/app-effect.server"
import { IS_TEST_RUNTIME } from "@/lib/runtime/environment.server"
import { tryPromiseInServerRequest } from "@/lib/runtime/server-request.server"
import { LOOPBACK_PROXY_ADDRESSES } from "@/lib/utils.server"
import {
  assertAuthEmailDelivered,
  deliverBlockingAuthEmail,
  withBlockingAuthEmailDelivery,
} from "./email-delivery.server.ts"
import type { AuthEmailNotDelivered } from "./errors.ts"
import { acceptedAtForUserCreation, assertLegalAcceptance, recordValue } from "./legal.server.ts"
import { createSyntheticUser } from "./synthetic-user.server.ts"

// Better Auth 1.7.2 keeps these defaults inline, so each passes to both its option and its email
// callback to keep the expiry and the copy in sync. https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/api/routes/email-verification.ts#L16-L40
const EMAIL_VERIFICATION_EXPIRY_SECONDS = 60 * 60

// Password reset:
// https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/api/routes/password.ts#L121-L143
const PASSWORD_RESET_EXPIRY_SECONDS = 60 * 60

// Organization invitation:
// https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/plugins/organization/adapter.ts#L1185-L1211
const ORGANIZATION_INVITATION_EXPIRY_SECONDS = 48 * 60 * 60

// The default basePath, which a resend outside an endpoint context must repeat because it cannot
// read `context.baseURL`. https://better-auth.com/docs/reference/options#basepath
const AUTH_BASE_PATH = "/api/auth"

interface AuthConfig {
  appBaseUrl: string
  betterAuthSecret: string
  google: { clientId: string; clientSecret: string } | null
  github: { clientId: string; clientSecret: string } | null
  legalAcceptanceRequired: boolean
  turnstileSecretKey: string
}

function authConfigFromValues(values: ConfigValues): AuthConfig | null {
  const { app_base_url: appBaseUrl, better_auth_secret: betterAuthSecret } = values
  if (!appBaseUrl || !betterAuthSecret || !values.turnstile_secret_key) return null
  return {
    appBaseUrl,
    betterAuthSecret,
    google:
      values.google_client_id && values.google_client_secret
        ? { clientId: values.google_client_id, clientSecret: values.google_client_secret }
        : null,
    github:
      values.github_client_id && values.github_client_secret
        ? { clientId: values.github_client_id, clientSecret: values.github_client_secret }
        : null,
    legalAcceptanceRequired: Boolean(values.privacy_policy_url || values.terms_of_service_url),
    turnstileSecretKey: values.turnstile_secret_key,
  }
}

// Rebuilds the `/sign-up/email` link for a resend outside an endpoint context, so signing up again
// recovers an unverified account. https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/api/routes/sign-up.ts
const buildVerificationURL = Effect.fn("buildVerificationURL")(function* (
  config: AuthConfig,
  email: string,
) {
  const token = yield* Effect.tryPromise(() =>
    createEmailVerificationToken(
      config.betterAuthSecret,
      email,
      undefined,
      EMAIL_VERIFICATION_EXPIRY_SECONDS,
    ),
  ).pipe(Effect.orDie)
  const url = new URL(`${AUTH_BASE_PATH}/verify-email`, config.appBaseUrl)
  url.searchParams.set("token", token)
  url.searchParams.set("callbackURL", "/")
  return url.toString()
})

// A password-change notice is informational and its recipient is not waiting on it, so it runs
// past the response instead of blocking like the emails deliverBlockingAuthEmail guards.
function notifyPasswordChanged(mailer: Mailer["Service"], user: { email: string }): Promise<void> {
  forkAppEffect(
    mailer
      .sendPasswordChanged({ user })
      .pipe(
        Effect.catchCause(() => Effect.logError("Password-change notification delivery failed")),
      ),
  )
  return Promise.resolve()
}

// A credential sign-up completes at verification and an OAuth one at creation, and neither waits
// on this informational email, so it runs past the response like the password-change notice.
function welcomeNewUser(
  mailer: Mailer["Service"],
  user: { name: string; email: string },
): Promise<void> {
  forkAppEffect(
    mailer
      .sendWelcome({ user })
      .pipe(Effect.catchCause(() => Effect.logError("Welcome email delivery failed"))),
  )
  return Promise.resolve()
}

// Replaces Better Auth's delete, whose separate last-key check let two concurrent deletions pass.
// Its own errors reach the hook unchanged, because a run rejects with its squashed cause.
const deleteOrganizationApiKey = Effect.fn("deleteOrganizationApiKey")(function* (input: {
  headers: Headers
  keyId: string
}): Effect.fn.Return<void, APIError, ApiKeys | Auth> {
  const auth = yield* Auth
  // Authorize reading the key before disclosing why it cannot be deleted.
  const key = yield* auth.api((api) =>
    api.getApiKey({ headers: input.headers, query: { id: input.keyId } }),
  )
  const permission = yield* auth.api((api) =>
    api.hasPermission({
      headers: input.headers,
      body: { organizationId: key.referenceId, permissions: { apiKey: ["delete"] } },
    }),
  )
  if (!permission.success) {
    return yield* Effect.fail(
      APIError.from("FORBIDDEN", API_KEY_ERROR_CODES.INSUFFICIENT_API_KEY_PERMISSIONS),
    )
  }
  yield* Effect.flatMap(ApiKeys, (apiKeys) =>
    apiKeys.remove({ organizationId: key.referenceId, keyId: input.keyId }),
  ).pipe(
    Effect.catchTags({
      ApiKeyNotFound: () =>
        Effect.fail(APIError.from("NOT_FOUND", API_KEY_ERROR_CODES.KEY_NOT_FOUND)),
      DogfoodApiKeyInUse: (error) =>
        Effect.fail(
          new APIError("FORBIDDEN", { code: "DOGFOOD_API_KEY_IN_USE", message: error.message }),
        ),
      LastApiKey: (error) =>
        Effect.fail(new APIError("FORBIDDEN", { code: "LAST_API_KEY", message: error.message })),
    }),
  )
})

function buildAuth(config: AuthConfig, mailer: Mailer["Service"]) {
  // Avoid losing organization session fields to plugin inference. https://github.com/better-auth/better-auth/issues/4222
  const turnstileAuthPlugin = captcha({
    provider: "cloudflare-turnstile",
    secretKey: config.turnstileSecretKey,
    endpoints: [
      "/sign-in/email",
      "/sign-up/email",
      "/request-password-reset",
      "/send-verification-email",
    ],
  }) as BetterAuthPlugin

  const enabledOAuthProviders = new Set<string>()
  if (config.google) enabledOAuthProviders.add("google")
  if (config.github) enabledOAuthProviders.add("github")

  return betterAuth({
    appName: APP_NAME,
    baseURL: config.appBaseUrl,
    secret: config.betterAuthSecret,
    database: drizzleAdapter(getAuthDatabase(), {
      provider: "pg",
      schema: tables,
      transaction: true,
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      autoSignIn: false,
      resetPasswordTokenExpiresIn: PASSWORD_RESET_EXPIRY_SECONDS,
      revokeSessionsOnPasswordReset: true,
      customSyntheticUser: ({ coreFields }) => createSyntheticUser(coreFields),
      sendResetPassword: ({ user, url }, request) =>
        deliverBlockingAuthEmail(
          request,
          mailer.sendResetPassword({ user, url, expiresInSeconds: PASSWORD_RESET_EXPIRY_SECONDS }),
        ),
      // A duplicate sign-up gets a synthetic user, so its real owner learns why only from this email.
      // Both branches send one email, so an outage fails either alike. https://better-auth.com/docs/concepts/email
      onExistingUserSignUp: ({ user }, request) =>
        deliverBlockingAuthEmail(
          request,
          user.emailVerified
            ? mailer.sendAccountExists({ user })
            : Effect.flatMap(buildVerificationURL(config, user.email), (url) =>
                mailer.sendVerification({
                  user,
                  url,
                  expiresInSeconds: EMAIL_VERIFICATION_EXPIRY_SECONDS,
                }),
              ),
        ),
      onPasswordReset: ({ user }) => notifyPasswordChanged(mailer, user),
    },
    emailVerification: {
      expiresIn: EMAIL_VERIFICATION_EXPIRY_SECONDS,
      sendOnSignUp: true,
      sendOnSignIn: false,
      autoSignInAfterVerification: true,
      // Better Auth returns before this callback for an already verified address.
      afterEmailVerification: (user) => welcomeNewUser(mailer, user),
      sendVerificationEmail: ({ user, url }, request) =>
        deliverBlockingAuthEmail(
          request,
          mailer.sendVerification({
            user,
            url,
            expiresInSeconds: EMAIL_VERIFICATION_EXPIRY_SECONDS,
          }),
        ),
    },
    socialProviders: {
      ...(config.google && {
        google: {
          clientId: config.google.clientId,
          clientSecret: config.google.clientSecret,
          disableImplicitSignUp: true,
          requireEmailVerification: true,
        },
      }),
      ...(config.github && {
        github: {
          clientId: config.github.clientId,
          clientSecret: config.github.clientSecret,
          disableImplicitSignUp: true,
          requireEmailVerification: true,
        },
      }),
    },
    account: {
      encryptOAuthTokens: true,
      storeStateStrategy: "database",
      // trustedProviders stays unset, so implicit linking needs both emails verified and never moves
      // an identity another user owns. https://better-auth.com/docs/concepts/users-accounts#account-linking
      accountLinking: {
        enabled: true,
        disableImplicitLinking: false,
        allowDifferentEmails: false,
        allowUnlinkingAll: false,
        updateUserInfoOnLink: false,
      },
    },
    session: {
      cookieCache: {
        enabled: false,
      },
    },
    verification: {
      storeIdentifier: "hashed",
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      customRules: {
        // Every path here sends one email to a caller-supplied address, so each is limited apart
        // from the general API bucket. https://better-auth.com/docs/concepts/rate-limit
        "/organization/invite-member": { window: 60, max: 5 },
        "/request-password-reset": { window: 60, max: 5 },
        "/send-verification-email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60, max: 5 },
      },
    },
    disabledPaths: ["/change-email", "/delete-user", "/delete-user/callback"],
    user: {
      validateUserInfo: ({ source, user }) => {
        if (source.method !== "oauth") return undefined
        if (
          !source.oauth ||
          !enabledOAuthProviders.has(source.oauth.providerId) ||
          user.emailVerified !== true
        ) {
          return {
            error: "verified_oauth_identity_required",
            errorDescription: "A verified identity from an enabled sign-in provider is required",
          }
        }
        return undefined
      },
      additionalFields: {
        termsAcceptedAt: {
          type: "date",
          required: false,
          input: false,
          returned: false,
        },
      },
    },
    // backgroundTasks stays unset, because a handler would defer each send past the response and
    // swallow its rejection behind a "check your inbox" screen. https://better-auth.com/docs/concepts/email
    advanced: {
      database: {
        // Let PostgreSQL apply the schema's UUIDv7 defaults. https://better-auth.com/docs/concepts/database#id-generation
        generateId: false,
        joins: true,
      },
      // Better Auth walks a forwarded chain to the first hop it does not own, and `/api/auth/$`
      // verifies the sender. https://better-auth.com/docs/concepts/rate-limit
      ipAddress: {
        trustedProxies: [...LOOPBACK_PROXY_ADDRESSES],
      },
    },
    hooks: {
      before: createAuthMiddleware(async (context) => {
        const body = recordValue(context.body)
        // Hash once before the original token consumption, leaving the endpoint and plugins intact.
        // Remove this request-scoped wrapper after https://github.com/better-auth/better-auth/pull/10717 ships.
        if (context.path === "/reset-password" && Predicate.isString(body?.newPassword)) {
          const { internalAdapter, password } = context.context
          const newPassword = body.newPassword
          const hashPassword = await runAppEffect(
            Effect.cached(
              tryPromiseInServerRequest(() => password.hash(newPassword)).pipe(Effect.orDie),
            ),
          )
          context.context.password = { ...password, hash: () => runAppEffect(hashPassword) }
          context.context.internalAdapter = {
            ...internalAdapter,
            consumeVerificationValue: (identifier) =>
              runAppEffect(
                Effect.gen(function* () {
                  const verification = yield* tryPromiseInServerRequest(() =>
                    internalAdapter.findVerificationValue(identifier),
                  )
                  const now = yield* Clock.currentTimeMillis
                  if (verification && verification.expiresAt.getTime() >= now) yield* hashPassword
                  return yield* tryPromiseInServerRequest(() =>
                    internalAdapter.consumeVerificationValue(identifier),
                  )
                }).pipe(Effect.orDie),
              ),
          }
          return
        }
        if (context.path === "/api-key/delete" && Predicate.isString(body?.keyId)) {
          // A returned body short-circuits the endpoint. https://better-auth.com/docs/concepts/hooks#before-hooks
          await runAppEffect(
            deleteOrganizationApiKey({
              headers: context.headers ?? new Headers(),
              keyId: body.keyId,
            }),
          )
          return context.json({ success: true })
        }
        const isApiKeyCreate = context.path === "/api-key/create"
        if (isApiKeyCreate || context.path === "/api-key/update") {
          // Better Auth recommends a before hook for endpoint-specific input adjustments. https://better-auth.com/docs/concepts/hooks#before-hooks
          const name = Predicate.isString(body?.name) ? body.name.trim() : undefined
          return {
            context: {
              ...context,
              body: {
                ...body,
                ...(name === undefined ? {} : { name }),
              },
            },
          }
        }
        if (context.path === "/sign-up/email") {
          if (config.legalAcceptanceRequired) assertLegalAcceptance(body?.termsAccepted)
          return
        }
        if (context.path !== "/sign-in/social" || body?.requestSignUp !== true) return

        if (config.legalAcceptanceRequired) {
          assertLegalAcceptance(recordValue(body.additionalData)?.termsAccepted)
          await addOAuthServerContext({ termsAccepted: true })
        }
        return
      }),
      after: createAuthMiddleware(async (context) => {
        assertAuthEmailDelivered(context.request)
        if (context.path !== "/change-password" || isAPIError(context.context.returned)) return
        const user = context.context.session?.user
        if (user) await notifyPasswordChanged(mailer, user)
      }),
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user, context) => {
            // It needs no service, and runAppEffect's type would cycle back through `Auth`.
            const termsAcceptedAt = config.legalAcceptanceRequired
              ? await Effect.runPromise(acceptedAtForUserCreation(context))
              : null

            return {
              data: {
                ...user,
                termsAcceptedAt,
              },
            }
          },
          after: async (user) => {
            if (user.emailVerified) await welcomeNewUser(mailer, user)
          },
        },
      },
    },
    plugins: [
      turnstileAuthPlugin,
      haveIBeenPwned({
        enabled: !IS_TEST_RUNTIME,
        paths: ["/sign-up/email", "/change-password", "/reset-password"],
      }),
      organization({
        ac: organizationAccessControl,
        roles: organizationRoles,
        organizationHooks: { ...organizationRoleHooks, ...organizationProvisioningHooks },
        invitationExpiresIn: ORGANIZATION_INVITATION_EXPIRY_SECONDS,
        requireEmailVerificationOnInvitation: true,
        disableOrganizationDeletion: true,
        sendInvitationEmail: (data, request) =>
          deliverBlockingAuthEmail(
            request,
            mailer.sendOrganizationInvitation({
              ...data,
              expiresInSeconds: ORGANIZATION_INVITATION_EXPIRY_SECONDS,
            }),
          ),
      }),
      organizationApiKeyPlugin,
      apiKey({
        defaultPrefix: ORGANIZATION_API_KEY_PREFIX,
        rateLimit: {
          maxRequests: ORGANIZATION_API_KEY_RATE_LIMIT_MAX_REQUESTS,
          timeWindow: ORGANIZATION_API_KEY_RATE_LIMIT_WINDOW_MS,
        },
        references: "organization",
        requireName: true,
        startingCharactersConfig: {
          charactersLength: ORGANIZATION_API_KEY_STARTING_CHARACTERS_LENGTH,
        },
        schema: {
          apikey: {
            modelName: "apiKey",
            fields: { referenceId: "organizationId" },
          },
        },
      }),
      tanstackStartCookies(),
    ],
  })
}

export type AppAuth = ReturnType<typeof buildAuth>
export type AuthSession = NonNullable<Awaited<ReturnType<AppAuth["api"]["getSession"]>>>

export class Auth extends Context.Service<
  Auth,
  {
    /** Better Auth built for the current configuration snapshot, rebuilt after it changes. */
    readonly instance: Effect.Effect<AppAuth>
    /** Calls a Better Auth server API whose failures no caller branches on. */
    readonly api: <A>(call: (api: AppAuth["api"]) => Promise<A>) => Effect.Effect<A>
    /** Like `api`, but `null` when Better Auth requires a fresh session, which the page prompts for. */
    readonly freshApi: <A>(call: (api: AppAuth["api"]) => Promise<A>) => Effect.Effect<A | null>
    /** Memoized per request headers, so one page render reads the session once. */
    readonly getSession: (input: { readonly headers: Headers }) => Effect.Effect<AuthSession | null>
    readonly requireSession: (input: {
      readonly headers: Headers
    }) => Effect.Effect<AuthSession, SignInRequired>
    readonly handler: (request: Request) => Effect.Effect<Response>
    /** Better Auth owns the organization table and rechecks the caller's permission itself. */
    readonly updateOrganization: (input: {
      readonly headers: Headers
      readonly organizationId: string
      readonly name: string
      readonly slug: string
    }) => Effect.Effect<void, OrganizationSlugTaken>
    /** Mails a password-reset link without a request, reporting a failed send. */
    readonly requestPasswordReset: (input: {
      readonly email: string
      readonly redirectTo: string
    }) => Effect.Effect<void, AuthEmailNotDelivered>
  }
>()("astralbeam/auth/Auth") {
  static readonly layerNoDeps = Layer.effect(
    Auth,
    Effect.gen(function* () {
      const config = yield* Config
      const mailer = yield* Mailer
      const built = yield* Ref.make<{ generation: number; auth: AppAuth } | null>(null)
      const sessions = new WeakMap<Headers, Effect.Effect<AuthSession | null>>()

      const instance = Effect.gen(function* () {
        const snapshot = yield* config.snapshot
        const current = yield* Ref.get(built)
        if (current?.generation === snapshot.generation) return current.auth
        const authConfig = authConfigFromValues(snapshot.values)
        if (!authConfig) return yield* Effect.die("Authentication configuration is incomplete")
        const auth = buildAuth(authConfig, mailer)
        yield* Ref.set(built, { generation: snapshot.generation, auth })
        return auth
      })

      const callApi = <A>(call: (api: AppAuth["api"]) => Promise<A>) =>
        Effect.flatMap(instance, (auth) => tryPromiseInServerRequest(() => call(auth.api)))

      // Dies with Better Auth's own error, which a hook rethrows to its caller unchanged.
      const api = <A>(call: (api: AppAuth["api"]) => Promise<A>) => callApi(call).pipe(Effect.orDie)

      /** Answers Better Auth's refusal with `code` through `onRefused`. Any other failure dies. */
      const apiUnlessRefused = <A, B, E>(
        call: (api: AppAuth["api"]) => Promise<A>,
        code: string,
        onRefused: () => Effect.Effect<B, E>,
      ) =>
        callApi(call).pipe(
          Effect.catch((cause) =>
            cause instanceof APIError && cause.body?.code === code
              ? onRefused()
              : Effect.die(cause),
          ),
        )

      const freshApi = <A>(call: (api: AppAuth["api"]) => Promise<A>) =>
        apiUnlessRefused(call, "SESSION_NOT_FRESH", () => Effect.succeed(null))

      const getSession = Effect.fn("Auth.getSession")(function* (input: { headers: Headers }) {
        const memoized = sessions.get(input.headers)
        if (memoized) return yield* memoized
        const lookup = yield* Effect.cached(
          api((auth) =>
            auth.getSession({ headers: input.headers, query: { disableCookieCache: true } }),
          ),
        )
        sessions.set(input.headers, lookup)
        return yield* lookup
      })

      const requireSession = (input: { headers: Headers }) =>
        Effect.flatMap(getSession(input), (session) =>
          session ? Effect.succeed(session) : Effect.fail(new SignInRequired()),
        )

      const handler = Effect.fn("Auth.handler")(function* (request: Request) {
        const auth = yield* instance
        return yield* tryPromiseInServerRequest(() => auth.handler(request)).pipe(Effect.orDie)
      })

      const updateOrganization = Effect.fn("Auth.updateOrganization")(function* (input: {
        headers: Headers
        organizationId: string
        name: string
        slug: string
      }) {
        yield* apiUnlessRefused(
          (api) =>
            api.updateOrganization({
              headers: input.headers,
              body: {
                organizationId: input.organizationId,
                data: { name: input.name, slug: input.slug },
              },
            }),
          "ORGANIZATION_SLUG_ALREADY_TAKEN",
          () => Effect.fail(new OrganizationSlugTaken()),
        )
      })

      const requestPasswordReset = Effect.fn("Auth.requestPasswordReset")(function* (input: {
        email: string
        redirectTo: string
      }) {
        const auth = yield* instance
        yield* withBlockingAuthEmailDelivery(() =>
          auth.api.requestPasswordReset({
            body: { email: input.email, redirectTo: input.redirectTo },
          }),
        )
      })

      return Auth.of({
        instance,
        api,
        freshApi,
        getSession,
        requireSession,
        handler,
        updateOrganization,
        requestPasswordReset,
      })
    }),
  )

  static readonly layer = Auth.layerNoDeps.pipe(Layer.provide([Config.layer, Mailer.layer]))
}
