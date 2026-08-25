import { readdir, writeFile } from "node:fs/promises"
import { dirname, extname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import sharp from "sharp"

const applicationDirectory = join(dirname(fileURLToPath(import.meta.url)), "..")
const publicDirectory = join(applicationDirectory, "public")
const logoSvgPattern = /^[a-z0-9-]+-(?:logo|wordmark)-(?:dark|light)\.svg$/u

const scale = Number(process.env.SCALE ?? "1")

if (!Number.isFinite(scale) || scale <= 0) {
  throw new Error(`SCALE must be a positive number; received ${process.env.SCALE}`)
}

let entries

try {
  entries = await readdir(publicDirectory, { withFileTypes: true })
} catch (error) {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") {
    throw new Error(`Public directory not found: ${publicDirectory}`, { cause: error })
  }

  throw error
}

const svgFiles = entries
  .filter((entry) => entry.isFile() && logoSvgPattern.test(entry.name))
  .map((entry) => entry.name)
  .toSorted()

if (svgFiles.length === 0) {
  throw new Error(`No logo SVG files found in ${publicDirectory}`)
}

// Process one image at a time to bound Sharp/libvips work and memory. https://sharp.pixelplumbing.com/performance/#parallelism-and-concurrency
for (const svgFile of svgFiles) {
  const pngFile = `${svgFile.slice(0, -extname(svgFile).length)}.png`
  const pngPath = join(publicDirectory, pngFile)

  // Sharp/libvips renders SVG viewBox units at 72 DPI, so this is equivalent
  // to the original script's rsvg-convert --zoom behavior.
  const output = await sharp(join(publicDirectory, svgFile), {
    density: 72 * scale,
  })
    .png()
    .toBuffer()

  await writeFile(pngPath, output)

  console.log(`Wrote ${relative(applicationDirectory, pngPath)}`)
}
