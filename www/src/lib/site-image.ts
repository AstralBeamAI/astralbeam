import type { APIRoute } from "astro"
import sharp from "sharp"

import darkLogoSvg from "@/assets/astralbeam-logo-dark.svg?raw"
import { palette } from "@/brand/palette"

const darkLogo = Buffer.from(darkLogoSvg)
const transparent = { r: 0, g: 0, b: 0, alpha: 0 }

// The favicon needs its own opaque plate, while the social card composites the mark
// over artwork that must keep showing through.
export function renderSiteLogo(size: number, { opaque = true } = {}) {
  const logo = sharp(darkLogo).resize({
    width: size,
    height: size,
    fit: "contain",
    background: transparent,
  })
  return (opaque ? logo.flatten({ background: palette.dark.background.srgbHex }) : logo)
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
