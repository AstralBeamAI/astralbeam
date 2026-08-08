import assert from "node:assert/strict"
import { readFile, stat } from "node:fs/promises"

const distUrl = new URL("../dist/", import.meta.url)
const index = await readFile(new URL("index.html", distUrl), "utf8")

assert.match(index, /Ship agents/)
assert.match(index, /Drop-in frontend SDK/)
assert.match(index, /mailto:hello@astralbeam\.ai/)
assert.match(index, /https:\/\/www\.astralbeam\.com\//)
assert.match(index, /application\/ld\+json/)
assert.doesNotMatch(index, /<script[^>]+src=/)

const expectedFiles = [
  "apple-touch-icon.png",
  "favicon.svg",
  "llms.txt",
  "og-image.png",
  "robots.txt",
  "site.webmanifest",
  "sitemap-index.xml",
]

for (const file of expectedFiles) {
  const result = await stat(new URL(file, distUrl))
  assert.equal(result.isFile(), true, `${file} was not generated`)
}

const robots = await readFile(new URL("robots.txt", distUrl), "utf8")
assert.match(robots, /https:\/\/www\.astralbeam\.com\/sitemap-index\.xml/)

console.log("Website build verified")
