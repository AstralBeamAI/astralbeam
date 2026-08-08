import { readFile } from "node:fs/promises"

import type { APIRoute } from "astro"

import { brandAssetPath } from "@/lib/brand-asset"

export const prerender = true

export const GET: APIRoute = async () => {
  const image = await readFile(brandAssetPath("svg/astralbeam-symbol.svg"), "utf8")

  return new Response(image, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  })
}
