import sharp from "sharp"

import darkLogoSvg from "@/assets/astralbeam-logo-dark.svg?raw"

const darkLogo = new TextEncoder().encode(darkLogoSvg)
const transparent = { r: 0, g: 0, b: 0, alpha: 0 }

export function renderSiteLogo(size: number) {
  return sharp(darkLogo)
    .resize({ width: size, height: size, fit: "contain", background: transparent })
    .png({ compressionLevel: 9 })
    .toBuffer()
}

export function createPngHandler(render: () => Promise<Uint8Array>) {
  return async () =>
    new Response(new Uint8Array(await render()), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": import.meta.env.DEV ? "no-cache" : "public, max-age=300",
      },
    })
}
