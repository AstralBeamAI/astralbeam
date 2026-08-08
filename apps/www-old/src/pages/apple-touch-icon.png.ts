import { readFile } from "node:fs/promises"

import type { APIRoute } from "astro"
import sharp from "sharp"

import { brandAssetPath } from "@/lib/brand-asset"
import { darkThemeSrgb } from "@/lib/theme"

export const prerender = true

export const GET: APIRoute = async () => {
  const logo = await sharp(await readFile(brandAssetPath("png/astralbeam-logo-square.png")))
    .negate({ alpha: false })
    .png()
    .toBuffer()
  const image = await sharp({
    create: {
      width: 720,
      height: 720,
      channels: 4,
      background: darkThemeSrgb.background,
    },
  })
    .composite([{ input: logo }])
    .png()
    .toBuffer()

  return new Response(new Uint8Array(image), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=3600",
    },
  })
}
