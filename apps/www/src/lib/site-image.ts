import sharp from "sharp"

import faviconDataUrl from "@astralbeam/brand/logo/png/astralbeam-favicon.png?inline"

const faviconDataPrefix = "data:image/png;base64,"

if (!faviconDataUrl.startsWith(faviconDataPrefix)) {
  throw new Error("Expected the AstralBeam favicon to be an inline PNG")
}

const faviconPng = Buffer.from(faviconDataUrl.slice(faviconDataPrefix.length), "base64")

export function getSiteIcon() {
  return Buffer.from(faviconPng)
}

export async function renderSiteIcon(size: number) {
  return sharp(faviconPng).resize(size, size).png().toBuffer()
}
