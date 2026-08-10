import type { APIRoute } from "astro"

import { getSiteIcon } from "@/lib/site-image"

export const prerender = true

export const GET: APIRoute = () =>
  new Response(new Uint8Array(getSiteIcon()), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=3600",
    },
  })
