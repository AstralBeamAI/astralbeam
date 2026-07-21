import type { APIRoute } from "astro"

import { darkThemeSrgb } from "@/lib/theme"

export const prerender = true

export const GET: APIRoute = ({ site }) => {
  const iconUrl = new URL("apple-touch-icon.png", site).href

  return new Response(
    JSON.stringify(
      {
        name: "AstralBeam",
        short_name: "AstralBeam",
        description: "Open-source infrastructure for shipping agents in minutes, not months.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: darkThemeSrgb.background,
        theme_color: darkThemeSrgb.background,
        icons: [{ src: iconUrl, sizes: "720x720", type: "image/png" }],
      },
      null,
      2,
    ),
    { headers: { "Content-Type": "application/manifest+json; charset=utf-8" } },
  )
}
