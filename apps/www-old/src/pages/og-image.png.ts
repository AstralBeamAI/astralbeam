import { readFile } from "node:fs/promises"

import type { APIRoute } from "astro"
import sharp from "sharp"

import { brandAssetPath } from "@/lib/brand-asset"
import { darkThemeSrgb } from "@/lib/theme"

export const prerender = true

export const GET: APIRoute = async () => {
  const logo = await sharp(await readFile(brandAssetPath("png/astralbeam-logo-square.png")))
    .resize(208, 208, { fit: "contain" })
    .negate({ alpha: false })
    .png()
    .toBuffer()
  const image = await sharp(Buffer.from(socialImageSvg()))
    .composite([{ input: logo, left: 76, top: 198 }])
    .png()
    .toBuffer()

  return new Response(new Uint8Array(image), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=3600",
    },
  })
}

function socialImageSvg() {
  return `<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
    <rect width="1200" height="630" fill="${darkThemeSrgb.background}"/>
    <rect x="42" y="42" width="1116" height="546" rx="18" fill="${darkThemeSrgb.card}" stroke="${darkThemeSrgb.border}" stroke-width="2"/>
    <rect x="70" y="192" width="220" height="220" rx="12" fill="${darkThemeSrgb.muted}" stroke="${darkThemeSrgb.border}"/>
    <text x="344" y="240" fill="${darkThemeSrgb.primary}" font-family="Inter, Arial, sans-serif" font-size="25" font-weight="700" letter-spacing="3">OPEN-SOURCE AGENT INFRASTRUCTURE</text>
    <text x="340" y="342" fill="${darkThemeSrgb.foreground}" font-family="Manrope, Inter, Arial, sans-serif" font-size="82" font-weight="600">Ship agents</text>
    <text x="340" y="428" fill="${darkThemeSrgb.mutedForeground}" font-family="Manrope, Inter, Arial, sans-serif" font-size="82" font-weight="600">in minutes</text>
    <path d="M76 472H1124" stroke="${darkThemeSrgb.border}" stroke-width="2"/>
    <text x="76" y="532" fill="${darkThemeSrgb.mutedForeground}" font-family="Inter, Arial, sans-serif" font-size="28">A single service for production-ready agents.</text>
  </svg>`
}
