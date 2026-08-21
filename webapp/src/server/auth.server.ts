import "@tanstack/react-start/server-only"

import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2"
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

import { CURRENT_TERMS_VERSION } from "@/auth/terms"
import {
  ORGANIZATION_CREATION_ENABLED,
  ORGANIZATION_LIMIT,
  ORGANIZATION_MEMBERSHIP_LIMIT,
} from "@/auth/organization-policy"
import { organizationAccessControl, organizationRoles } from "@/auth/organization-access-control"
import { type Database, database as productionDatabase } from "@/db/database.server"
import * as schema from "@/db/schema.server"

import { type ServerEnvironment, serverEnvironment } from "./env.server"
import { activatePendingOrganizationAccess } from "./organization-access.server"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function hasCurrentTermsAcceptance(value: unknown) {
  return (
    isRecord(value) && value.termsAccepted === true && value.termsVersion === CURRENT_TERMS_VERSION
  )
}

interface AuthOptions {
  database: Database
  environment: ServerEnvironment
}

function createAuth({ database, environment }: AuthOptions) {
  return betterAuth({
    appName: "AstralBeam",
    baseURL: environment.BETTER_AUTH_URL,
    secret: environment.BETTER_AUTH_SECRET,
    trustedOrigins: [environment.BETTER_AUTH_URL],
    database: drizzleAdapter(database, { provider: "pg", schema }),
    account: { encryptOAuthTokens: true },
    // UUID mode lets PostgreSQL-backed adapters use the schema's UUIDv7 defaults. https://better-auth.com/docs/concepts/database#id-generation
    advanced: { database: { generateId: "uuid", joins: true } },
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
            const [sessionUser] = await database
              .select({
                email: schema.user.email,
                emailVerified: schema.user.emailVerified,
                id: schema.user.id,
              })
              .from(schema.user)
              .where(eq(schema.user.id, session.userId))
              .limit(1)

            if (sessionUser) {
              await activatePendingOrganizationAccess(database, sessionUser)
            }

            const [membership] = await database
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
            return {
              data: {
                ...user,
                email: user.email,
                termsAcceptedAt: new Date(),
                termsVersion: CURRENT_TERMS_VERSION,
              },
            }
          },
          after: async (createdUser) => {
            await activatePendingOrganizationAccess(database, createdUser)
          },
        },
      },
    },
    telemetry: { enabled: false },
    rateLimit: { storage: "database" },
    socialProviders: {
      github: {
        clientId: environment.GITHUB_CLIENT_ID,
        clientSecret: environment.GITHUB_CLIENT_SECRET,
        disableImplicitSignUp: true,
        requireEmailVerification: true,
      },
      google: {
        clientId: environment.GOOGLE_CLIENT_ID,
        clientSecret: environment.GOOGLE_CLIENT_SECRET,
        disableImplicitSignUp: true,
        requireEmailVerification: true,
      },
    },
    plugins: [
      organization({
        ac: organizationAccessControl,
        allowUserToCreateOrganization: ORGANIZATION_CREATION_ENABLED,
        creatorRole: "owner",
        disableOrganizationDeletion: true,
        membershipLimit: ORGANIZATION_MEMBERSHIP_LIMIT,
        organizationLimit: ORGANIZATION_LIMIT,
        roles: organizationRoles,
        teams: { enabled: false },
      }),
      // This integration must be last so TanStack Start can forward response cookies.
      tanstackStartCookies(),
    ],
  })
}

export const auth = createAuth({
  database: productionDatabase,
  environment: serverEnvironment,
})
