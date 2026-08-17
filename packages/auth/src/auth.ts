import "@tanstack/react-start/server-only"
import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2"
import { db } from "@astralbeam/db"
import * as schema from "@astralbeam/db/schema"
import {
  addOAuthServerContext,
  APIError,
  createAuthMiddleware,
  getOAuthState,
} from "better-auth/api"
import { betterAuth } from "better-auth/minimal"
import { organization } from "better-auth/plugins/organization"
import { tanstackStartCookies } from "better-auth/tanstack-start"
import { asc, eq } from "drizzle-orm"

import { CURRENT_TERMS_VERSION } from "./terms"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function hasCurrentTermsAcceptance(value: unknown) {
  return (
    isRecord(value) && value.termsAccepted === true && value.termsVersion === CURRENT_TERMS_VERSION
  )
}

export const auth = betterAuth({
  appName: "AstralBeam",
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  account: {
    encryptOAuthTokens: true,
  },
  hooks: {
    before: createAuthMiddleware(async (context) => {
      if (context.path !== "/sign-in/social" || !isRecord(context.body)) return
      if (context.body.requestSignUp !== true) return

      if (!hasCurrentTermsAcceptance(context.body.additionalData)) {
        throw new APIError("BAD_REQUEST", {
          code: "TERMS_NOT_ACCEPTED",
          message: "Accept the current Terms of Service before creating an account.",
        })
      }

      // Client-supplied OAuth additional data must be validated before a trusted value crosses the provider redirect. https://better-auth.com/docs/concepts/oauth#passing-additional-data-through-oauth-flow
      await addOAuthServerContext({
        termsAccepted: true,
        termsVersion: CURRENT_TERMS_VERSION,
      })
    }),
  },
  user: {
    additionalFields: {
      termsAcceptedAt: {
        type: "date",
        required: true,
        input: false,
        returned: false,
        defaultValue: () => new Date(),
      },
      termsVersion: {
        type: "string",
        required: true,
        input: false,
        returned: false,
        defaultValue: CURRENT_TERMS_VERSION,
      },
    },
  },
  databaseHooks: {
    session: {
      create: {
        before: async (session) => {
          const [membership] = await db
            .select({ organizationId: schema.member.organizationId })
            .from(schema.member)
            .where(eq(schema.member.userId, session.userId))
            .orderBy(asc(schema.member.createdAt))
            .limit(1)

          return membership
            ? { data: { ...session, activeOrganizationId: membership.organizationId } }
            : { data: session }
        },
      },
    },
    user: {
      create: {
        before: async (user) => {
          const oauthState = await getOAuthState()

          if (
            oauthState?.requestSignUp !== true ||
            !hasCurrentTermsAcceptance(oauthState.serverContext)
          ) {
            throw new APIError("BAD_REQUEST", {
              code: "TERMS_NOT_ACCEPTED",
              message: "Accept the current Terms of Service before creating an account.",
            })
          }

          return { data: user }
        },
      },
    },
  },
  telemetry: {
    enabled: false,
  },
  rateLimit: {
    storage: "database",
  },
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60,
    },
  },
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      disableImplicitSignUp: true,
    },
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      disableImplicitSignUp: true,
    },
  },
  advanced: {
    database: {
      joins: true,
    },
  },
  // This integration must remain the final plugin so TanStack Start receives auth cookies. https://better-auth.com/docs/integrations/tanstack
  plugins: [
    organization({
      allowUserToCreateOrganization: true,
      disableOrganizationDeletion: true,
      organizationLimit: 5,
      membershipLimit: 100,
      invitationLimit: 50,
      invitationExpiresIn: 48 * 60 * 60,
      cancelPendingInvitationsOnReInvite: true,
      requireEmailVerificationOnInvitation: true,
      creatorRole: "owner",
    }),
    tanstackStartCookies(),
  ],
})

export type AuthSession = typeof auth.$Infer.Session
export type AuthUser = AuthSession["user"]
