import process from "node:process"

import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2"
import { getRequest } from "@tanstack/react-start/server"
import type { BetterAuthPlugin } from "better-auth"
import { betterAuth } from "better-auth/minimal"
import { addOAuthServerContext, createAuthMiddleware, isAPIError } from "better-auth/api"
import { captcha, haveIBeenPwned, organization } from "better-auth/plugins"
import { tanstackStartCookies } from "better-auth/tanstack-start"

import { db } from "@/db/index.server"
import { tables } from "@/db/schema.server"
import {
  sendOrganizationInvitationEmail,
  sendPasswordChangedEmail,
  sendResetPasswordEmail,
  sendVerificationEmail,
} from "@/emails/index"
import { getRequiredConfig } from "@/lib/config.server"
import type { ConfigSnapshot } from "@/lib/types"
import { APP_NAME } from "@/lib/constants"
import {
  acceptedAtForUserCreation,
  assertLegalAcceptance,
  recordValue,
} from "@/lib/auth/legal.server"
import { organizationRoles } from "@/lib/auth/organization-access"
import { organizationRoleHooks } from "@/lib/auth/organization-hooks.server"
import { createSyntheticUser } from "@/lib/auth/synthetic-user.server"

const AUTH_EMAIL_EXPIRY_SECONDS = 60 * 60
const ORGANIZATION_INVITATION_EXPIRY_SECONDS = 48 * 60 * 60
type RequestWithWaitUntil = Request & {
  waitUntil?: (promise: Promise<unknown>) => void
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

async function notifyPasswordChanged(user: { email: string }): Promise<void> {
  await runAfterResponse(
    sendPasswordChangedEmail({ user }).catch(() => {
      console.error("Password-change notification delivery failed")
    }),
  )
}

// The instance is built from the database-backed config snapshot; `getAuth` rebuilds it whenever
// the snapshot version changes so credential and secret updates apply without a restart.
function buildAuth(snapshot: ConfigSnapshot) {
  if (!snapshot.appBaseUrl) {
    throw new Error("Required authentication configuration is unavailable")
  }
  if (!snapshot.turnstile) {
    throw new Error("Cloudflare Turnstile configuration is required")
  }

  // Avoid losing organization session fields to plugin inference. https://github.com/better-auth/better-auth/issues/4222
  const turnstileAuthPlugin = captcha({
    provider: "cloudflare-turnstile",
    secretKey: snapshot.turnstile.secretKey,
    endpoints: ["/sign-in/email", "/sign-up/email", "/request-password-reset"],
  }) as BetterAuthPlugin

  const enabledOAuthProviders = new Set<string>()
  if (snapshot.google) enabledOAuthProviders.add("google")
  if (snapshot.github) enabledOAuthProviders.add("github")

  return betterAuth({
    appName: APP_NAME,
    baseURL: snapshot.appBaseUrl ?? undefined,
    secret: snapshot.betterAuthSecret ?? undefined,
    database: drizzleAdapter(db, {
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
      resetPasswordTokenExpiresIn: AUTH_EMAIL_EXPIRY_SECONDS,
      revokeSessionsOnPasswordReset: true,
      customSyntheticUser: ({ coreFields }) => createSyntheticUser(coreFields),
      // Better Auth schedules the returned promise through advanced.backgroundTasks. https://better-auth.com/docs/concepts/email
      sendResetPassword: ({ user, url }) => sendResetPasswordEmail({ user, url }),
      onPasswordReset: async ({ user }) => {
        await notifyPasswordChanged(user)
      },
    },
    emailVerification: {
      expiresIn: AUTH_EMAIL_EXPIRY_SECONDS,
      sendOnSignUp: true,
      sendOnSignIn: false,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await runAfterResponse(sendVerificationEmail({ user, url }))
      },
    },
    socialProviders: {
      ...(snapshot.google && {
        google: {
          clientId: snapshot.google.clientId,
          clientSecret: snapshot.google.clientSecret,
          disableImplicitSignUp: true,
          requireEmailVerification: true,
        },
      }),
      ...(snapshot.github && {
        github: {
          clientId: snapshot.github.clientId,
          clientSecret: snapshot.github.clientSecret,
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
        // Limit invitation-triggered email independently of the general API bucket. https://better-auth.com/docs/concepts/rate-limit
        "/organization/invite-member": { window: 60, max: 5 },
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
    advanced: {
      database: {
        // Let PostgreSQL apply the schema's UUIDv7 defaults. https://better-auth.com/docs/concepts/database#id-generation
        generateId: false,
        joins: true,
      },
      backgroundTasks: {
        // Nitro exposes request.waitUntil in its Deno adapter. https://better-auth.com/docs/concepts/email
        handler: (promise) => {
          void runAfterResponse(promise).catch(() => {
            console.error("Authentication background task failed")
          })
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (context) => {
        const body = recordValue(context.body)
        if (context.path === "/sign-up/email") {
          assertLegalAcceptance(body?.termsAccepted)
          return
        }
        if (context.path !== "/sign-in/social" || body?.requestSignUp !== true) return

        assertLegalAcceptance(recordValue(body.additionalData)?.termsAccepted)
        await addOAuthServerContext({ termsAccepted: true })
      }),
      after: createAuthMiddleware(async (context) => {
        if (context.path !== "/change-password" || isAPIError(context.context.returned)) return
        const user = context.context.session?.user
        if (user) await notifyPasswordChanged(user)
      }),
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user, context) => {
            const termsAcceptedAt = await acceptedAtForUserCreation(context)

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
        roles: organizationRoles,
        organizationHooks: organizationRoleHooks,
        invitationExpiresIn: ORGANIZATION_INVITATION_EXPIRY_SECONDS,
        requireEmailVerificationOnInvitation: true,
        disableOrganizationDeletion: true,
        sendInvitationEmail: async (data) => {
          await sendOrganizationInvitationEmail(data)
        },
      }),
      tanstackStartCookies(),
    ],
  })
}

type AppAuth = ReturnType<typeof buildAuth>

let cachedAuth: { version: string; auth: AppAuth } | null = null

export async function getAuth(): Promise<AppAuth> {
  const snapshot = await getRequiredConfig()
  if (cachedAuth?.version !== snapshot.version) {
    cachedAuth = { version: snapshot.version, auth: buildAuth(snapshot) }
  }
  return cachedAuth.auth
}
