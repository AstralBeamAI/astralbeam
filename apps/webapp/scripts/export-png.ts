import { mkdir, readdir, writeFile } from "node:fs/promises"
import { dirname, extname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import sharp from "sharp"

const webappDirectory = join(dirname(fileURLToPath(import.meta.url)), "..")
const assetGroup = process.argv.slice(2).find((argument) => argument !== "--") ?? "logo"

if (!/^[a-z0-9-]+$/u.test(assetGroup)) {
  throw new Error(
    `Asset group must contain only lowercase letters, numbers, and hyphens; received ${assetGroup}`,
  )
}

const assetDirectory = join(webappDirectory, "src", "brand", assetGroup)
const svgDirectory = join(assetDirectory, "svg")
const pngDirectory = join(assetDirectory, "png")

const scale = Number(process.env.SCALE ?? "1")

if (!Number.isFinite(scale) || scale <= 0) {
  throw new Error(`SCALE must be a positive number; received ${process.env.SCALE}`)
}

let entries

try {
  entries = await readdir(svgDirectory, { withFileTypes: true })
} catch (error) {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") {
    throw new Error(`SVG folder not found: ${svgDirectory}`, { cause: error })
  }

  throw error
}

const svgFiles = entries
  .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === ".svg")
  .map((entry) => entry.name)
  .toSorted()

if (svgFiles.length === 0) {
  throw new Error(`No SVG files found in ${svgDirectory}`)
}

await mkdir(pngDirectory, { recursive: true })

// Process one image at a time to bound Sharp/libvips work and memory. https://sharp.pixelplumbing.com/performance/#parallelism-and-concurrency
/* oxlint-disable no-await-in-loop */
for (const svgFile of svgFiles) {
  const pngFile = `${svgFile.slice(0, -extname(svgFile).length)}.png`
  const pngPath = join(pngDirectory, pngFile)

  // Sharp/libvips renders SVG viewBox units at 72 DPI, so this is equivalent
  // to the original script's rsvg-convert --zoom behavior.
  const output = await sharp(join(svgDirectory, svgFile), {
    density: 72 * scale,
  })
    .png()
    .toBuffer()

  await writeFile(pngPath, output)

  console.log(`Wrote ${relative(webappDirectory, pngPath)}`)
}
/* oxlint-enable no-await-in-loop */
