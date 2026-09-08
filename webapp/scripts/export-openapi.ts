import { OpenApi } from "effect/unstable/httpapi"
import { readFile, writeFile } from "node:fs/promises"
import { argv } from "node:process"
import { TenantRestApi } from "../src/routes/api/v1/-lib/contract.server.ts"

const managementApiSnapshot = new URL("../openapi.json", import.meta.url)
const managementApiJson = JSON.stringify(OpenApi.fromApi(TenantRestApi), null, 2) + "\n"
if (argv.includes("--check")) {
  if (await readFile(managementApiSnapshot, "utf8") !== managementApiJson) {
    throw new Error("OpenAPI snapshot is stale. Run deno task generate:openapi.")
  }
} else {
  await writeFile(managementApiSnapshot, managementApiJson)
}
