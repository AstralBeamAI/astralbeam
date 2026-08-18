import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import type { APIRoute } from "astro"

export const prerender = true

const themeSchemaPath = resolve("../webapp/src/theme/theme.schema.json")

export const GET: APIRoute = async () =>
  new Response(await readFile(themeSchemaPath, "utf8"), {
    headers: { "Content-Type": "application/schema+json; charset=utf-8" },
  })
