import { OpenApi } from "effect/unstable/httpapi"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { argv } from "node:process"
import { ApiV1 } from "../src/routes/api/v1/-lib/contract.server.ts"

const apiSnapshot = new URL("../public/api/openapi.json", import.meta.url)
const document = OpenApi.fromApi(ApiV1)
document.servers = [{ url: "/" }]
document.info.description = (await Promise.all(
  ["getting-started", "authentication", "pagination-and-errors"].map((page) =>
    readFile(new URL(`../src/routes/docs/-content/api/${page}.md`, import.meta.url), "utf8")
  ),
)).join("\n\n")
const apiJson = JSON.stringify(document, null, 2) + "\n"
if (argv.includes("--check")) {
  if (await readFile(apiSnapshot, "utf8") !== apiJson) {
    throw new Error("OpenAPI snapshot is stale. Run deno task generate:openapi.")
  }
} else {
  await mkdir(new URL(".", apiSnapshot), { recursive: true })
  await writeFile(apiSnapshot, apiJson)
}
