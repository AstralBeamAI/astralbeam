import { join, relative } from "node:path"
import sharp from "sharp"

const applicationDirectory = join(import.meta.dir, "..")
const publicDirectory = join(applicationDirectory, "public")
const logoSvgPattern = /^[a-z0-9-]+-(?:logo|wordmark)-(?:dark|light)\.svg$/u

const scale = Number(process.env.SCALE ?? "1")

if (!Number.isFinite(scale) || scale <= 0) {
  throw new Error(`SCALE must be a positive number; received ${process.env.SCALE}`)
}

const svgFiles = [...new Bun.Glob("*.svg").scanSync(publicDirectory)]
  .filter((name) => logoSvgPattern.test(name))
  .toSorted()

if (svgFiles.length === 0) {
  throw new Error(`No logo SVG files found in ${publicDirectory}`)
}

// Process one image at a time to bound Sharp/libvips work and memory. https://sharp.pixelplumbing.com/performance/#parallelism-and-concurrency
for (const svgFile of svgFiles) {
  const pngFile = svgFile.replace(/\.svg$/u, ".png")
  const pngPath = join(publicDirectory, pngFile)

  // Sharp/libvips renders SVG viewBox units at 72 DPI, so this is equivalent
  // to the original script's rsvg-convert --zoom behavior.
  const output = await sharp(join(publicDirectory, svgFile), {
    density: 72 * scale,
  })
    .png({ compressionLevel: 9 })
    .toBuffer()

  await Bun.write(pngPath, output)

  console.log(`Wrote ${relative(applicationDirectory, pngPath)}`)
}
