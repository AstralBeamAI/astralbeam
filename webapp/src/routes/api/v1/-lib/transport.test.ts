import { describe, expect, test } from "vitest"
import { OpenApi } from "effect/unstable/httpapi"
import { TenantRestApi } from "./contract.server"
describe("REST request boundaries", () => {
  test("OpenAPI preserves effective authorization and numeric pagination without falsely rejecting capped values", () => {
    const document = OpenApi.fromApi(TenantRestApi)
    const operation = document.paths["/api/v1/tenants"]!.get!
    expect(operation.security).toEqual([{ OrganizationApiKey: [] }, { Bearer: [] }])
    const size = operation.parameters
      ?.find((parameter) => parameter.name === "page_size")?.schema
    expect(size).toMatchObject({ type: "integer", minimum: 1, default: 20 })
    expect(size).not.toHaveProperty("maximum")
    expect(
      Object.keys(document.components.schemas).filter((name) => name.startsWith("TenantRecord")),
    )
      .toEqual(["TenantRecordEncoded"])
  })
})
