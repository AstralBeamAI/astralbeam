import { OpenApi } from "effect/http-api"
import { ApiV1 } from "@/routes/api/v1/-lib/contract.server.ts"

const apiSnapshot = new URL("../public/api/openapi.json", import.meta.url)
const document = OpenApi.fromApi(ApiV1)
document.servers = [{ url: "/" }]
document.info.description = (
  await Promise.all(
    ["getting-started", "authentication", "pagination-and-errors"].map((page) =>
      Bun.file(new URL(`../src/routes/docs/-content/api/${page}.md`, import.meta.url)).text(),
    ),
  )
).join("\n\n")
const apiJson = JSON.stringify(document, null, 2) + "\n"
if (Bun.argv.includes("--check")) {
  if ((await Bun.file(apiSnapshot).text()) !== apiJson) {
    throw new Error("OpenAPI snapshot is stale. Run bun run generate:openapi.")
  }
} else {
  await Bun.write(apiSnapshot, apiJson)
}
