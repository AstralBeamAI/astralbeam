import { OpenApi } from "effect/unstable/httpapi"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { argv } from "node:process"
import { TenantRestApi } from "../src/routes/api/v1/-lib/contract.server.ts"

const managementApiSnapshot = new URL("../public/api/openapi.json", import.meta.url)
const document = OpenApi.fromApi(TenantRestApi)
document.servers = [{ url: "/" }]
document.info.description = (await Promise.all(
  ["getting-started", "authentication", "pagination-and-errors"].map((page) =>
    readFile(new URL(`../src/routes/docs/-content/api/${page}.md`, import.meta.url), "utf8")
  ),
)).join("\n\n")
const managementApiJson = JSON.stringify(document, null, 2) + "\n"
if (argv.includes("--check")) {
  if (await readFile(managementApiSnapshot, "utf8") !== managementApiJson) {
    throw new Error("OpenAPI snapshot is stale. Run deno task generate:openapi.")
  }
} else {
  await mkdir(new URL(".", managementApiSnapshot), { recursive: true })
  await writeFile(managementApiSnapshot, managementApiJson)
}
