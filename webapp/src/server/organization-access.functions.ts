import { createServerFn } from "@tanstack/react-start"
import { Schema } from "effect"

import { organizationMiddleware } from "./auth-middleware"

const email = Schema.String.pipe(
  Schema.check(Schema.isTrimmed()),
  Schema.check(
    Schema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/u, { message: "Enter a valid email address" }),
  ),
)
const identifier = Schema.String.pipe(Schema.check(Schema.isUUID(7)))
const role = Schema.Literals(["member", "admin"])

const addOrganizationAccessSchema = Schema.toStandardSchemaV1(
  Schema.Struct({ email, requestedRole: role }),
)
const updateOrganizationAccessSchema = Schema.toStandardSchemaV1(
  Schema.Struct({ grantId: identifier, requestedRole: role }),
)
const revokeOrganizationAccessSchema = Schema.toStandardSchemaV1(
  Schema.Struct({ grantId: identifier }),
)

export const addOrganizationAccess = createServerFn({ method: "POST" })
  .middleware([organizationMiddleware])
  .validator(addOrganizationAccessSchema)
  .handler(async ({ context, data }) => {
    const [{ database }, implementation] = await Promise.all([
      import("@/db/database.server"),
      import("./organization-access.server"),
    ])
    return implementation.addOrganizationAccess(database, context.organizationActor, data)
  })

export const listPendingOrganizationAccess = createServerFn({ method: "GET" })
  .middleware([organizationMiddleware])
  .handler(async ({ context }) => {
    const [{ database }, implementation] = await Promise.all([
      import("@/db/database.server"),
      import("./organization-access.server"),
    ])
    return implementation.listPendingOrganizationAccess(database, context.organizationActor)
  })

export const updatePendingOrganizationAccessRole = createServerFn({ method: "POST" })
  .middleware([organizationMiddleware])
  .validator(updateOrganizationAccessSchema)
  .handler(async ({ context, data }) => {
    const [{ database }, implementation] = await Promise.all([
      import("@/db/database.server"),
      import("./organization-access.server"),
    ])
    return implementation.updatePendingOrganizationAccessRole(
      database,
      context.organizationActor,
      data,
    )
  })

export const revokePendingOrganizationAccess = createServerFn({ method: "POST" })
  .middleware([organizationMiddleware])
  .validator(revokeOrganizationAccessSchema)
  .handler(async ({ context, data }) => {
    const [{ database }, implementation] = await Promise.all([
      import("@/db/database.server"),
      import("./organization-access.server"),
    ])
    return implementation.revokePendingOrganizationAccess(
      database,
      context.organizationActor,
      data,
    )
  })
