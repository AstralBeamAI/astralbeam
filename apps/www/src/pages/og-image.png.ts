import type { APIRoute } from "astro"
import sharp from "sharp"

import { renderSiteIcon } from "@/lib/site-image"
import { siteMetadata, sitePalette } from "@/lib/site"

export const prerender = true

export const GET: APIRoute = async () => {
  const logo = await renderSiteIcon(132)
  const image = await sharp(Buffer.from(socialCardSvg()))
    .composite([{ input: logo, left: 974, top: 72 }])
    .png()
    .toBuffer()

  return new Response(new Uint8Array(image), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=3600",
    },
  })
}

function socialCardSvg() {
  return `<svg width="${siteMetadata.socialImage.width}" height="${siteMetadata.socialImage.height}" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="glow" cx="78%" cy="14%" r="72%">
        <stop offset="0" stop-color="${sitePalette.accent}" stop-opacity="0.16"/>
        <stop offset="0.52" stop-color="${sitePalette.background}" stop-opacity="0"/>
      </radialGradient>
      <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
        <path d="M48 0H0V48" fill="none" stroke="${sitePalette.border}" stroke-width="1" opacity="0.22"/>
      </pattern>
      <filter id="beam-glow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="9" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    <rect width="1200" height="630" fill="${sitePalette.background}"/>
    <rect width="1200" height="630" fill="url(#grid)"/>
    <rect width="1200" height="630" fill="url(#glow)"/>
    <path d="M1080 -30L872 660" stroke="${sitePalette.accent}" stroke-width="3" opacity="0.62" filter="url(#beam-glow)"/>
    <rect x="38" y="38" width="1124" height="554" rx="8" fill="none" stroke="${sitePalette.border}" stroke-width="2"/>
    <path d="M38 94V38H94M1106 38H1162V94M38 536V592H94M1106 592H1162V536" fill="none" stroke="${sitePalette.accent}" stroke-width="3"/>
    <circle cx="96" cy="94" r="3" fill="${sitePalette.accent}"/>
    <text x="80" y="112" fill="${sitePalette.accent}" font-family="DejaVu Sans Mono, monospace" font-size="22" font-weight="700" letter-spacing="4">// OPEN-SOURCE AGENT INFRASTRUCTURE</text>
    <text x="76" y="272" fill="${sitePalette.foreground}" font-family="DejaVu Sans, Arial, sans-serif" font-size="82" font-weight="700" letter-spacing="2">SHIP AGENTS</text>
    <text x="76" y="370" fill="${sitePalette.foreground}" font-family="DejaVu Sans, Arial, sans-serif" font-size="82" font-weight="700" letter-spacing="2">IN MINUTES</text>
    <text x="76" y="468" fill="${sitePalette.accent}" font-family="DejaVu Sans, Arial, sans-serif" font-size="82" font-weight="700" letter-spacing="2">NOT MONTHS</text>
    <path d="M80 516H1120" stroke="${sitePalette.border}" stroke-width="2"/>
    <text x="80" y="558" fill="${sitePalette.muted}" font-family="DejaVu Sans Mono, monospace" font-size="20" letter-spacing="2">ONE SERVICE. PRODUCTION-READY.</text>
    <text x="1120" y="558" text-anchor="end" fill="${sitePalette.foreground}" font-family="DejaVu Sans Mono, monospace" font-size="20" font-weight="700" letter-spacing="2">ASTRALBEAM.AI</text>
  </svg>`
}
