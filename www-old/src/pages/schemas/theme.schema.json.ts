import themeSchemaText from "@/brand/theme.schema.json?raw"
import type { APIRoute } from "astro"

export const prerender = true

export const GET: APIRoute = () =>
  new Response(themeSchemaText, {
    headers: { "Content-Type": "application/schema+json; charset=utf-8" },
  })
