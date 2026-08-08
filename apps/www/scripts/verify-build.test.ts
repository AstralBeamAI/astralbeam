import { readFile } from "node:fs/promises"

import sharp from "sharp"
import { describe, expect, test } from "vite-plus/test"

const origin = "https://www.astralbeam.ai"
const homeUrl = `${origin}/`
const distUrl = new URL("../dist/", import.meta.url)

function readText(path: string) {
  return readFile(new URL(path, distUrl), "utf8")
}

describe("production website build", () => {
  test("renders the homepage with discovery metadata", async () => {
    const html = await readText("index.html")

    expect(html).toContain("SHIP AGENTS")
    expect(html).toContain("mailto:hello@astralbeam.ai")
    expect(html).toContain(`<link rel="canonical" href="${homeUrl}">`)
    expect(html).toContain('<meta name="robots" content="index,follow">')
    expect(html).toContain(`<meta property="og:image" content="${origin}/og-image.png">`)
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">')
    expect(html).toContain('<link rel="manifest" href="/site.webmanifest">')
    expect(html).toMatch(/application\/ld\+json/u)
    expect(html).not.toMatch(/astralbeam\.com/iu)
  })

  test("keeps the not-found page out of discovery", async () => {
    const html = await readText("404.html")

    expect(html).toContain("SIGNAL LOST")
    expect(html).toContain('<meta name="robots" content="noindex,nofollow">')
    expect(html).not.toContain('rel="canonical"')
    expect(html).not.toContain('property="og:image"')
  })

  test("publishes discovery files", async () => {
    const [robots, llms, sitemapIndex, sitemap, manifestText] = await Promise.all([
      readText("robots.txt"),
      readText("llms.txt"),
      readText("sitemap-index.xml"),
      readText("sitemap-0.xml"),
      readText("site.webmanifest"),
      readText("favicon.svg"),
    ])
    const manifest: unknown = JSON.parse(manifestText)

    expect(robots).toContain(`Sitemap: ${origin}/sitemap-index.xml`)
    expect(llms).toMatch(/^# AstralBeam$/mu)
    expect(llms).toContain(homeUrl)
    expect(sitemapIndex).toContain(`${origin}/sitemap-0.xml`)
    expect(sitemap).toContain(`<loc>${homeUrl}</loc>`)
    expect(sitemap).not.toContain("/404")
    expect(manifest).toMatchObject({
      name: "AstralBeam",
      theme_color: "#04080a",
      icons: expect.arrayContaining([expect.objectContaining({ sizes: "512x512" })]),
    })
  })

  test.each([
    { file: "apple-touch-icon.png", width: 180, height: 180 },
    { file: "icon-512.png", width: 512, height: 512 },
    { file: "og-image.png", width: 1200, height: 630 },
  ])("renders $file at $width x $height", async ({ file, width, height }) => {
    const metadata = await sharp(await readFile(new URL(file, distUrl))).metadata()

    expect(metadata).toMatchObject({ width, height })
  })
})
