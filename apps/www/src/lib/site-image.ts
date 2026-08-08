import sharp from "sharp"

import faviconSvg from "@/assets/favicon.svg?raw"

export async function renderSiteIcon(size: number) {
  return sharp(Buffer.from(faviconSvg), { density: 288 }).resize(size, size).png().toBuffer()
}
