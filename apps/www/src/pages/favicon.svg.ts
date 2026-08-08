import type { APIRoute } from "astro"

import faviconSvg from "@/assets/favicon.svg?raw"

export const prerender = true

export const GET: APIRoute = () =>
  new Response(faviconSvg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  })
