import type { APIRoute } from "astro"

import { renderSiteIcon } from "@/lib/site-image"

export const prerender = true

export const GET: APIRoute = async () => {
  const image = await renderSiteIcon(512)

  return new Response(new Uint8Array(image), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=3600",
    },
  })
}
