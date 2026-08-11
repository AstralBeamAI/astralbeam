import darkLogoSvg from "@astralbeam/brand/logo/svg/astralbeam-logo-dark.svg?raw"
import { palette } from "@astralbeam/brand/theme"
import type { APIRoute } from "astro"
import sharp from "sharp"

const darkLogo = Buffer.from(darkLogoSvg)

export async function renderSiteLogo(size: number) {
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
