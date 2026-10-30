import { readdir, readFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { relative } from "node:path"
import { fileURLToPath } from "node:url"

import sharp from "sharp"
import { describe, expect, test } from "vitest"

import { palette } from "../src/brand/palette"
import { blogPosts } from "../src/lib/blog"
import { landingUpdated, siteMetadata } from "../src/lib/site"

const origin = "https://astralbeam.ai"
const homeUrl = `${origin}/`
const iconUrl = `${origin}${siteMetadata.icon.path}`
const iconSize = `${siteMetadata.icon.size}x${siteMetadata.icon.size}`
const distUrl = new URL("../.output/public/", import.meta.url)

function readText(path: string) {
  return readFile(new URL(path, distUrl), "utf8")
}

describe("production website build", () => {
  test("gives every published asset exactly one cache policy", async () => {
    const rules = (await readText("_headers")).split("\n\n").flatMap((block) => {
      const path = /^\/\S*$/mu.exec(block)?.[0]
      const cache = /^ {2}Cache-Control: (.+)$/mu.exec(block)?.[1]
      return path && cache ? [{ path, cache }] : []
    })
    for (const file of await readdir(distUrl, { recursive: true, withFileTypes: true })) {
      if (!file.isFile() || file.name === "_headers") continue
      const path = `/${relative(fileURLToPath(distUrl), `${file.parentPath}/${file.name}`)}`
        .replace(/\/index\.html$/u, "/")
        .replace(/\.html$/u, "")
      const matches = rules.filter((rule) =>
        rule.path.endsWith("*") ? path.startsWith(rule.path.slice(0, -1)) : path === rule.path,
      )
      expect({ path, policies: matches.map((rule) => rule.cache) }).toEqual({
        path,
        policies: [expect.any(String)],
      })
    }
  })

  test("publishes the CLI skill with a digest of the exact served bytes", async () => {
    const source = await readFile(new URL("../../skills/astralbeam/SKILL.md", import.meta.url))
    const payload = await readFile(new URL("agent-skills/astralbeam/SKILL.md", distUrl))
    const index: unknown = JSON.parse(await readText(".well-known/agent-skills/index.json"))
    expect(payload).toEqual(source)
    expect(index).toMatchObject({
      skills: [
        {
          digest: `sha256:${createHash("sha256").update(payload).digest("hex")}`,
        },
      ],
    })
  })

  test("renders the homepage with discovery metadata", async () => {
    const html = await readText("index.html")

    expect(html).toContain(`<link rel="canonical" href="${homeUrl}"/>`)
    expect(await readText("home.html")).toContain(`<link rel="canonical" href="${homeUrl}"/>`)
    expect(html).toContain('<meta name="robots" content="index,follow"/>')
    expect(html).toContain(
      `<meta name="theme-color" content="${palette.dark.background.srgbHex}"/>`,
    )
    expect(html).toMatch(/<html[^>]*class="dark"/u)
    expect(html).toContain(`<meta property="og:image" content="${origin}/og-image.png"/>`)
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image"/>')
    expect(html).toMatch(
      /<img[^>]*class="hud-brand-wordmark"[^>]*src="[^"]*astralbeam-wordmark-dark[^"]*\.svg"/u,
    )
    expect(html).toMatch(
      /<link rel="icon" type="image\/svg\+xml" href="[^"]*astralbeam-logo-light[^"]*\.svg" media="\(prefers-color-scheme: light\)"\/>/u,
    )
    expect(html).toMatch(
      /<link rel="icon" type="image\/svg\+xml" href="[^"]*astralbeam-logo-dark[^"]*\.svg" media="\(prefers-color-scheme: dark\)"\/>/u,
    )
    expect(html).toContain(
      `<link rel="icon" type="image/png" sizes="${iconSize}" href="${siteMetadata.icon.path}"/>`,
    )
    expect(html).toContain(
      `<link rel="apple-touch-icon" sizes="${iconSize}" href="${siteMetadata.icon.path}"/>`,
    )
    expect(html).toContain(`"logo":"${iconUrl}"`)
    expect(html).not.toMatch(/\/(?:apple-touch-icon|icon-512)\.png/u)
    expect(html).not.toMatch(/(?:--site-|data-(?:near|far|streak)-rgb)/u)
    expect(html).toContain('<link rel="manifest" href="/site.webmanifest"/>')
    expect(html).toContain('<link rel="license" href="/licenses.txt"/>')
    expect(html).toMatch(/application\/ld\+json/u)
    expect(html).toContain(`"name":"${siteMetadata.title}"`)
    expect(html).not.toMatch(/astralbeam\.com/iu)
  })

  test("publishes and links the legal pages", async () => {
    const [home, terms, privacy] = await Promise.all([
      readText("index.html"),
      readText("terms.html"),
      readText("privacy.html"),
    ])

    expect(home).toContain('href="/terms"')
    expect(home).toContain('href="/privacy"')
    expect(terms).toContain(`<link rel="canonical" href="${origin}/terms"/>`)
    expect(terms).toContain("Terms of Service")
    expect(privacy).toContain(`<link rel="canonical" href="${origin}/privacy"/>`)
    expect(privacy).toContain("Google API Services User Data Policy")
  })

  test("publishes a current security contact and landing page update date", async () => {
    const [home, security, sitemap] = await Promise.all([
      readText("index.html"),
      readText(".well-known/security.txt"),
      readText("sitemap.xml"),
    ])
    expect(security).toContain(
      "Contact: https://github.com/AstralBeamAI/astralbeam/security/advisories/new",
    )
    const expiry = security.match(/^Expires: (.+)$/mu)?.[1]
    expect(expiry).toBeDefined()
    expect(Date.parse(expiry!)).toBeGreaterThan(Date.now())
    expect(home).toContain(`"dateModified":"${landingUpdated}"`)
    expect(sitemap).toContain(`<lastmod>${landingUpdated}</lastmod>`)
  })

  test("ships brand colors without Node APIs", async () => {
    const assetDirectory = new URL("website-assets/", distUrl)
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

    expect(html).toContain('<meta name="robots" content="noindex,nofollow"/>')
    expect(html).not.toContain('rel="canonical"')
    expect(html).not.toContain('property="og:image"')
  })

  test("publishes discovery files", async () => {
    const [headers, robots, llms, licenses, sitemap, manifestText, mitLicense, oflLicense] =
      await Promise.all([
        readText("_headers"),
        readText("robots.txt"),
        readText("llms.txt"),
        readText("licenses.txt"),
        readText("sitemap.xml"),
        readText("site.webmanifest"),
        readFile(new URL("../../LICENSE-MIT", import.meta.url), "utf8"),
        readFile(new URL("../../docs/legal/LICENSES/OFL-1.1.txt", import.meta.url), "utf8"),
      ])
    const manifest: unknown = JSON.parse(manifestText)

    expect(headers).toContain("frame-ancestors 'none'")
    expect(robots).toContain(`Sitemap: ${origin}/sitemap.xml`)
    expect(robots).toContain("Content-Signal: search=yes, ai-input=yes, ai-train=yes")
    expect(llms).toMatch(/^# AstralBeam$/mu)
    expect(llms).toContain(homeUrl)
    expect(licenses).toContain(mitLicense.trimEnd())
    expect(licenses).toContain(oflLicense.trimEnd())
    expect(sitemap).toContain(`<loc>${homeUrl}</loc>`)
    expect(sitemap).toContain(`<loc>${origin}/privacy</loc><lastmod>2026-10-17</lastmod>`)
    expect(sitemap).toContain(`<loc>${origin}/terms</loc><lastmod>2026-09-21</lastmod>`)
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

  test("renders the social image at 1200 x 630", async () => {
    const metadata = await sharp(await readFile(new URL("og-image.png", distUrl))).metadata()

    expect(metadata).toMatchObject({ width: 1200, height: 630 })
  })

  test("publishes every Markdown post with its discovery metadata and artwork", async () => {
    const [home, index, sitemap, feed, llms, headers] = await Promise.all([
      readText("index.html"),
      readText("blog.html"),
      readText("sitemap.xml"),
      readText("blog/feed.xml"),
      readText("llms.txt"),
      readText("_headers"),
    ])
    expect(home).toContain('href="/blog"')
    expect(index).toContain(`<link rel="canonical" href="${origin}/blog"/>`)
    for (const post of blogPosts) {
      const html = await readText(`${post.path.slice(1)}.html`)
      const markdown = await readText(`${post.path.slice(1)}.md`)
      expect(markdown).toBe(
        await readFile(new URL(`../src/content${post.path}.md`, import.meta.url), "utf8"),
      )
      expect(html).toContain(`rel="alternate" type="text/plain" href="${post.path}.md"`)
      expect(headers).toContain(
        `${post.path}.md\n  Content-Type: text/plain; charset=utf-8\n  Content-Disposition: inline`,
      )
      expect(index).toContain(`href="${post.path}"`)
      expect(sitemap).toContain(`<loc>${origin}${post.path}</loc><lastmod>${post.date}</lastmod>`)
      expect(feed).toContain(`<link>${origin}${post.path}</link>`)
      expect(llms).toContain(`[${post.title}](${origin}${post.path})`)
      expect(html).toContain(`<link rel="canonical" href="${origin}${post.path}"/>`)
      expect(html).toContain('property="og:type" content="article"')
      expect(html).toContain(`property="og:image" content="${origin}${post.image}"`)
      expect(html).toContain('"@type":"BlogPosting"')
      expect(html).not.toContain('class="language-demo"')
      expect(await sharp(new URL(post.image.slice(1), distUrl).pathname).metadata()).toMatchObject({
        width: 1200,
        height: 630,
      })
      expect(await readText(post.image.slice(1).replace(/\.png$/u, ".svg"))).toContain("<svg")
    }
  })
})
