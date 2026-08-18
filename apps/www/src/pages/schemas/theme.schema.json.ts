import { readFile } from "node:fs/promises"

import type { APIRoute } from "astro"

export const prerender = true

const themeSchemaUrl = new URL(import.meta.resolve("@astralbeam/webapp/theme.schema.json"))

export const GET: APIRoute = async () =>
  new Response(await readFile(themeSchemaUrl, "utf8"), {
    headers: { "Content-Type": "application/schema+json; charset=utf-8" },
  })
