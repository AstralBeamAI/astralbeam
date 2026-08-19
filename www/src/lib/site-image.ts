import type { APIRoute } from "astro"
import sharp from "sharp"

import darkLogoSvg from "@/assets/astralbeam-logo-dark.svg?raw"
import { palette } from "@/brand/palette"

const darkLogo = Buffer.from(darkLogoSvg)

export function renderSiteLogo(size: number) {
  return sharp(darkLogo)
    .resize({ width: size, height: size, fit: "contain" })
    .flatten({ background: palette.dark.background.srgbHex })
    .png()
    .toBuffer()
}

export function createPngRoute(render: () => Promise<Uint8Array>): APIRoute {
  return async () =>
    new Response(new Uint8Array(await render()), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=3600",
      },
    })
}
