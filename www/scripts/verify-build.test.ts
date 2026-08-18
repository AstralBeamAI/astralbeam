import { readFile, readdir } from "node:fs/promises"

import sharp from "sharp"
import { describe, expect, test } from "vitest"

import { palette } from "../src/brand/palette"
import { siteMetadata } from "../src/lib/site"

const origin = "https://www.astralbeam.ai"
const homeUrl = `${origin}/`
const iconUrl = `${origin}${siteMetadata.icon.path}`
const iconSize = `${siteMetadata.icon.size}x${siteMetadata.icon.size}`
const distUrl = new URL("../dist/", import.meta.url)

function readText(path: string) {
  return readFile(new URL(path, distUrl), "utf8")
}

describe("production website build", () => {
  test("renders the homepage with discovery metadata", async () => {
    const html = await readText("index.html")

    expect(html).toContain(`<link rel="canonical" href="${homeUrl}">`)
    expect(html).toContain('<meta name="robots" content="index,follow">')
    expect(html).toContain(`<meta name="theme-color" content="${palette.dark.background.srgbHex}">`)
    expect(html).toMatch(/<html[^>]*class="dark"/u)
    expect(html).toContain(`<meta property="og:image" content="${origin}/og-image.png">`)
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">')
    expect(html).toMatch(
      /<img[^>]*class="hud-brand-wordmark"[^>]*src="[^"]*astralbeam-wordmark-dark[^"]*\.svg"/u,
    )
    expect(html).toMatch(
      /<link rel="icon" type="image\/svg\+xml" href="[^"]*astralbeam-logo-light[^"]*\.svg" media="\(prefers-color-scheme: light\)">/u,
    )
    expect(html).toMatch(
      /<link rel="icon" type="image\/svg\+xml" href="[^"]*astralbeam-logo-dark[^"]*\.svg" media="\(prefers-color-scheme: dark\)">/u,
    )
    expect(html).toContain(
      `<link rel="icon" type="image/png" sizes="${iconSize}" href="${siteMetadata.icon.path}">`,
    )
    expect(html).toContain(
      `<link rel="apple-touch-icon" sizes="${iconSize}" href="${siteMetadata.icon.path}">`,
    )
    expect(html).toContain(`"logo":"${iconUrl}"`)
    expect(html).not.toMatch(/\/(?:apple-touch-icon|icon-512)\.png/u)
    expect(html).not.toMatch(/(?:--site-|data-(?:near|far|streak)-rgb)/u)
    expect(html).toContain('<link rel="manifest" href="/site.webmanifest">')
    expect(html).toContain('<link rel="license" href="/licenses.txt">')
    expect(html).toMatch(/application\/ld\+json/u)
    expect(html).not.toMatch(/astralbeam\.com/iu)
  })

  test("publishes and links the legal pages", async () => {
    const [home, terms, privacy] = await Promise.all([
      readText("index.html"),
      readText("terms/index.html"),
      readText("privacy/index.html"),
    ])

    expect(home).toContain('href="/terms"')
    expect(home).toContain('href="/privacy"')
    expect(terms).toContain(`<link rel="canonical" href="${origin}/terms">`)
    expect(terms).toContain("Terms of Service")
    expect(privacy).toContain(`<link rel="canonical" href="${origin}/privacy">`)
    expect(privacy).toContain("Google API Services User Data Policy")
  })

  test("ships brand colors without Node APIs", async () => {
    const assetDirectory = new URL("_astro/", distUrl)
    const assets = await readdir(assetDirectory)
    const [stylesheets, scripts] = await Promise.all([
      Promise.all(
        assets
          .filter((asset) => asset.endsWith(".css"))
          .map((asset) => readFile(new URL(asset, assetDirectory), "utf8")),
      ),
      Promise.all(
        assets
          .filter((asset) => asset.endsWith(".js"))
          .map((asset) => readFile(new URL(asset, assetDirectory), "utf8")),
      ),
    ])
    const css = stylesheets.join("\n")
    const javascript = scripts.join("\n")

    expect(css).toContain("--background:")
    expect(css).toContain("--primary:")
    expect(css).toContain("--chart-5:")
    expect(css).not.toContain("--site-")
    expect(javascript).not.toContain("node:fs")
  })

  test("keeps the not-found page out of discovery", async () => {
    const html = await readText("404.html")

    expect(html).toContain('<meta name="robots" content="noindex,nofollow">')
    expect(html).not.toContain('rel="canonical"')
    expect(html).not.toContain('property="og:image"')
  })

  test("publishes discovery files", async () => {
    const [robots, llms, licenses, sitemapIndex, sitemap, manifestText, mitLicense, oflLicense] =
      await Promise.all([
        readText("robots.txt"),
        readText("llms.txt"),
        readText("licenses.txt"),
        readText("sitemap-index.xml"),
        readText("sitemap-0.xml"),
        readText("site.webmanifest"),
        readFile(new URL("../../LICENSE-MIT", import.meta.url), "utf8"),
        readFile(new URL("../../docs/legal/LICENSES/OFL-1.1.txt", import.meta.url), "utf8"),
      ])
    const manifest: unknown = JSON.parse(manifestText)

    expect(robots).toContain(`Sitemap: ${origin}/sitemap-index.xml`)
    expect(llms).toMatch(/^# AstralBeam$/mu)
    expect(llms).toContain(homeUrl)
    expect(licenses).toContain(mitLicense.trimEnd())
    expect(licenses).toContain(oflLicense.trimEnd())
    expect(sitemapIndex).toContain(`${origin}/sitemap-0.xml`)
    expect(sitemap).toContain(`<loc>${homeUrl}</loc>`)
    expect(sitemap).toContain(`<loc>${origin}/privacy/</loc>`)
    expect(sitemap).toContain(`<loc>${origin}/terms/</loc>`)
    expect(sitemap).not.toContain("/404")
    expect(manifest).toMatchObject({
      name: "AstralBeam",
      background_color: palette.dark.background.srgbHex,
      theme_color: palette.dark.background.srgbHex,
      icons: [
        {
          src: iconUrl,
          sizes: iconSize,
          type: "image/png",
          purpose: "any",
        },
      ],
    })
  })

  test("publishes the strict compact theme authoring schema", async () => {
    const publishedSchemaText = await readText("schemas/theme.schema.json")
    const masterSchemaText = await readFile(
      new URL("../src/brand/theme.schema.json", import.meta.url),
      "utf8",
    )

    expect(publishedSchemaText).toBe(masterSchemaText)
  })

  test("renders the social image at 1200 x 630", async () => {
    const metadata = await sharp(await readFile(new URL("og-image.png", distUrl))).metadata()

    expect(metadata).toMatchObject({ width: 1200, height: 630 })
  })
})
