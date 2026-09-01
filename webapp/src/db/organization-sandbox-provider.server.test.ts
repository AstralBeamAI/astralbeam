import * as Effect from "effect/Effect"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { sandboxProvider } from "./schema/organizations.server.ts"

const repositoryState = vi.hoisted(() => ({
  row: null as typeof sandboxProvider.$inferSelect | null,
  db: { select: vi.fn() },
}))

vi.mock("@/db", () => ({
  effectDatabase: Effect.succeed(repositoryState.db),
  runDatabaseEffect: Effect.runPromise,
}))

import { runDatabaseEffect } from "@/db"
import { resolveOrganizationSandboxProviderConfiguration } from "./organization-sandbox-provider.server.ts"

const ORGANIZATION_ID = "01992a80-1d71-7f24-a150-f1177e3f6419"
const SANDBOX_PROVIDER_ID = "01992a80-1d71-7f24-a150-f1177e3f6420"

describe("organization sandbox provider credentials", () => {
  beforeEach(() => {
    repositoryState.db.select.mockReset().mockReturnValue({
      from: () => ({
        where: () => ({
          limit: () => Effect.succeed(repositoryState.row ? [repositoryState.row] : []),
        }),
      }),
    })
    repositoryState.row = {
      id: SANDBOX_PROVIDER_ID,
      organizationId: ORGANIZATION_ID,
      name: "Primary Daytona",
      providerType: "daytona",
      options: { target: "us", snapshot: "daytona-medium" },
      credentials: {
        sandboxProviderId: SANDBOX_PROVIDER_ID,
        organizationId: ORGANIZATION_ID,
        providerType: "daytona",
        credentials: { apiKey: "secret" },
      },
      lastTest: null,
      lockVersion: 0,
      createdAt: new Date("2026-08-31T00:00:00.000Z"),
      updatedAt: new Date("2026-08-31T00:00:00.000Z"),
    }
  })

  it("rejects credentials copied to another provider row", async () => {
    await expect(runDatabaseEffect(resolveOrganizationSandboxProviderConfiguration(
      ORGANIZATION_ID,
      SANDBOX_PROVIDER_ID,
    ))).resolves.toMatchObject({ credentials: { apiKey: "secret" } })

    repositoryState.row = {
      ...repositoryState.row!,
      id: "01992a80-1d71-7f24-a150-f1177e3f6421",
    }
    await expect(runDatabaseEffect(resolveOrganizationSandboxProviderConfiguration(
      ORGANIZATION_ID,
      repositoryState.row.id,
    ))).rejects.toMatchObject({
      _tag: "OrganizationSandboxProviderRepositoryError",
    })
  })
})
