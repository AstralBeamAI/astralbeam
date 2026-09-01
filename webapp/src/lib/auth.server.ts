import process from "node:process"

import { apiKey } from "@better-auth/api-key"
import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2"
import { getRequest } from "@tanstack/react-start/server"
import type { BetterAuthPlugin } from "better-auth"
import { betterAuth } from "better-auth/minimal"
import {
  addOAuthServerContext,
  createAuthMiddleware,
  createEmailVerificationToken,
  isAPIError,
} from "better-auth/api"
import { captcha, haveIBeenPwned, organization } from "better-auth/plugins"
import { tanstackStartCookies } from "better-auth/tanstack-start"

import { db } from "@/db"
import { tables } from "@/db/schema.server"
import {
  sendAccountExistsEmail,
  sendOrganizationInvitationEmail,
  sendPasswordChangedEmail,
  sendResetPasswordEmail,
  sendVerificationEmail,
} from "@/emails/index"
import { getGlobalConfig } from "@/lib/config"
import { APP_NAME } from "@/lib/constants"
import {
  assertAuthEmailDelivered,
  deliverBlockingAuthEmail,
} from "@/lib/auth/email-delivery.server"
import {
  acceptedAtForUserCreation,
  assertLegalAcceptance,
  recordValue,
} from "@/lib/auth/legal.server"
import {
  ORGANIZATION_API_KEY_PREFIX,
  ORGANIZATION_API_KEY_RATE_LIMIT_MAX_REQUESTS,
  ORGANIZATION_API_KEY_RATE_LIMIT_WINDOW_MS,
  ORGANIZATION_API_KEY_STARTING_CHARACTERS_LENGTH,
} from "@/lib/auth/organization-api-key-configuration"
import { organizationAccessControl, organizationRoles } from "@/lib/auth/organization-access"
import {
  organizationApiKeyPlugin,
  organizationProvisioningHooks,
  organizationRoleHooks,
  withOrganizationApiKeySlug,
} from "@/lib/auth/organization-hooks.server"
import { createSyntheticUser } from "@/lib/auth/synthetic-user.server"

// Better Auth 1.7.2 keeps these defaults inline rather than exporting them. Pass each value to
// both its auth option and email callback so the real expiry and rendered copy stay in sync.
// Verification:
// https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/api/routes/email-verification.ts#L16-L40
const EMAIL_VERIFICATION_EXPIRY_SECONDS = 60 * 60

// Password reset:
// https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/api/routes/password.ts#L121-L143
const PASSWORD_RESET_EXPIRY_SECONDS = 60 * 60

// Organization invitation:
// https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/plugins/organization/adapter.ts#L1185-L1211
const ORGANIZATION_INVITATION_EXPIRY_SECONDS = 48 * 60 * 60

// Better Auth mounts its routes under this default basePath, which the verification link has to
// repeat because a resend outside an endpoint context cannot read `context.baseURL`.
// https://better-auth.com/docs/reference/options#basepath
const AUTH_BASE_PATH = "/api/auth"

type RequestWithWaitUntil = Request & {
  waitUntil?: (promise: Promise<unknown>) => void
}

/**
 * Rebuilds the link `/sign-up/email` would have mailed, for a resend that happens outside an
 * endpoint context. The token is the same signed JWT `/verify-email` accepts, so an unverified
 * account can be recovered by signing up again.
 * https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/api/routes/sign-up.ts
 */
async function buildVerificationURL(config: AuthConfig, email: string): Promise<string> {
  const token = await createEmailVerificationToken(
    config.betterAuthSecret,
    email,
    undefined,
    EMAIL_VERIFICATION_EXPIRY_SECONDS,
  )
  const url = new URL(`${AUTH_BASE_PATH}/verify-email`, config.appBaseUrl)
  url.searchParams.set("token", token)
  url.searchParams.set("callbackURL", "/")
  return url.toString()
}

async function runAfterResponse(promise: Promise<unknown>): Promise<void> {
  try {
    const request = getRequest() as RequestWithWaitUntil
    if (typeof request.waitUntil === "function") {
      request.waitUntil(promise)
      return
    }
  } catch {
    // Auth CLI calls and direct server API calls can run outside TanStack's request context.
  }
  await promise
}

// A password-change notice is informational and its recipient is not waiting on it, so it stays
// deferred past the response instead of blocking like the emails deliverBlockingAuthEmail guards.
async function notifyPasswordChanged(user: { email: string }): Promise<void> {
  await runAfterResponse(
    sendPasswordChangedEmail({ user }).catch(() => {
      console.error("Password-change notification delivery failed")
    }),
  )
}

interface AuthConfig {
  appBaseUrl: string
  betterAuthSecret: string
  google: { clientId: string; clientSecret: string } | null
  github: { clientId: string; clientSecret: string } | null
  legalAcceptanceRequired: boolean
  turnstileSecretKey: string
}

function buildAuth(config: AuthConfig) {
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
    database: withOrganizationApiKeySlug(
      drizzleAdapter(db, {
        provider: "pg",
        schema: tables,
        transaction: true,
      }),
    ),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      autoSignIn: false,
      resetPasswordTokenExpiresIn: PASSWORD_RESET_EXPIRY_SECONDS,
      revokeSessionsOnPasswordReset: true,
      customSyntheticUser: ({ coreFields }) => createSyntheticUser(coreFields),
      sendResetPassword: ({ user, url }) =>
        deliverBlockingAuthEmail(() =>
          sendResetPasswordEmail({
            user,
            url,
            expiresInSeconds: PASSWORD_RESET_EXPIRY_SECONDS,
          })
        ),
      // Better Auth answers a duplicate sign-up with a synthetic user so the response cannot
      // confirm the address exists, which otherwise leaves the address's real owner on a "check
      // your inbox" screen forever. Both branches send exactly one email, so a provider outage
      // fails a duplicate sign-up and a new one identically. https://better-auth.com/docs/concepts/email
      onExistingUserSignUp: ({ user }) =>
        deliverBlockingAuthEmail(async () => {
          if (user.emailVerified) {
            await sendAccountExistsEmail({ user })
            return
          }
          await sendVerificationEmail({
            user,
            url: await buildVerificationURL(config, user.email),
            expiresInSeconds: EMAIL_VERIFICATION_EXPIRY_SECONDS,
          })
        }),
      onPasswordReset: async ({ user }) => {
        await notifyPasswordChanged(user)
      },
    },
    emailVerification: {
      expiresIn: EMAIL_VERIFICATION_EXPIRY_SECONDS,
      sendOnSignUp: true,
      sendOnSignIn: false,
      autoSignInAfterVerification: true,
      sendVerificationEmail: ({ user, url }) =>
        deliverBlockingAuthEmail(() =>
          sendVerificationEmail({
            user,
            url,
            expiresInSeconds: EMAIL_VERIFICATION_EXPIRY_SECONDS,
          })
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
      // Keep trustedProviders unset so implicit linking requires both the provider identity and existing user email to be verified; never transfer an identity already owned by another user. https://better-auth.com/docs/concepts/users-accounts#account-linking
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
    // backgroundTasks stays unset so Better Auth awaits each email send inside the request. A
    // handler would defer the send past the response and swallow its rejection, which is what let
    // a failed send complete behind a "check your inbox" screen. https://better-auth.com/docs/concepts/email
    advanced: {
      database: {
        // Let PostgreSQL apply the schema's UUIDv7 defaults. https://better-auth.com/docs/concepts/database#id-generation
        generateId: false,
        joins: true,
      },
    },
    hooks: {
      before: createAuthMiddleware(async (context) => {
        const body = recordValue(context.body)
        const isApiKeyCreate = context.path === "/api-key/create"
        if (isApiKeyCreate || context.path === "/api-key/update") {
          // Better Auth recommends a before hook for endpoint-specific input adjustments. https://better-auth.com/docs/concepts/hooks#before-hooks
          const name = typeof body?.name === "string" ? body.name.trim() : undefined
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
        assertAuthEmailDelivered()
        if (context.path !== "/change-password" || isAPIError(context.context.returned)) return
        const user = context.context.session?.user
        if (user) await notifyPasswordChanged(user)
      }),
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user, context) => {
            const termsAcceptedAt = config.legalAcceptanceRequired
              ? await acceptedAtForUserCreation(context)
              : null

            return {
              data: {
                ...user,
                termsAcceptedAt,
              },
            }
          },
        },
      },
    },
    plugins: [
      turnstileAuthPlugin,
      haveIBeenPwned({
        enabled: process.env.VITEST !== "true" && process.env.NODE_ENV !== "test",
        paths: ["/sign-up/email", "/change-password", "/reset-password"],
      }),
      organization({
        ac: organizationAccessControl,
        roles: organizationRoles,
        organizationHooks: { ...organizationRoleHooks, ...organizationProvisioningHooks },
        invitationExpiresIn: ORGANIZATION_INVITATION_EXPIRY_SECONDS,
        requireEmailVerificationOnInvitation: true,
        disableOrganizationDeletion: true,
        sendInvitationEmail: (data) =>
          deliverBlockingAuthEmail(() =>
            sendOrganizationInvitationEmail({
              ...data,
              expiresInSeconds: ORGANIZATION_INVITATION_EXPIRY_SECONDS,
            })
          ),
      }),
      organizationApiKeyPlugin,
      apiKey({
        defaultPrefix: ORGANIZATION_API_KEY_PREFIX,
        enableMetadata: true,
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

type AppAuth = ReturnType<typeof buildAuth>

let cachedAuth: { cacheKey: string; auth: AppAuth } | null = null

export async function getAuth(): Promise<AppAuth> {
  const [
    appBaseUrl,
    betterAuthSecret,
    googleClientId,
    googleClientSecret,
    githubClientId,
    githubClientSecret,
    privacyPolicyUrl,
    termsOfServiceUrl,
    turnstileSecretKey,
  ] = await Promise.all([
    getGlobalConfig("app_base_url"),
    getGlobalConfig("better_auth_secret"),
    getGlobalConfig("google_client_id"),
    getGlobalConfig("google_client_secret"),
    getGlobalConfig("github_client_id"),
    getGlobalConfig("github_client_secret"),
    getGlobalConfig("privacy_policy_url"),
    getGlobalConfig("terms_of_service_url"),
    getGlobalConfig("turnstile_secret_key"),
  ])
  if (!appBaseUrl || !betterAuthSecret || !turnstileSecretKey) {
    throw new Error("Required authentication configuration is unavailable")
  }
  const config: AuthConfig = {
    appBaseUrl,
    betterAuthSecret,
    google: googleClientId && googleClientSecret
      ? { clientId: googleClientId, clientSecret: googleClientSecret }
      : null,
    github: githubClientId && githubClientSecret
      ? { clientId: githubClientId, clientSecret: githubClientSecret }
      : null,
    legalAcceptanceRequired: Boolean(privacyPolicyUrl || termsOfServiceUrl),
    turnstileSecretKey,
  }
  const cacheKey = JSON.stringify(config)
  if (cachedAuth?.cacheKey !== cacheKey) {
    cachedAuth = { cacheKey, auth: buildAuth(config) }
  }
  return cachedAuth.auth
}
