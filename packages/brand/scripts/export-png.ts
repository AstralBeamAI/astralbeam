import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, extname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import sharp from "sharp"

const packageDirectory = join(dirname(fileURLToPath(import.meta.url)), "..")
const assetGroup = process.argv.slice(2).find((argument) => argument !== "--") ?? "logo"

if (!/^[a-z0-9-]+$/u.test(assetGroup)) {
  throw new Error(
    `Asset group must contain only lowercase letters, numbers, and hyphens; received ${assetGroup}`,
  )
}

const assetDirectory = join(packageDirectory, "src", assetGroup)
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
  .sort()

if (svgFiles.length === 0) {
  throw new Error(`No SVG files found in ${svgDirectory}`)
}

await mkdir(pngDirectory, { recursive: true })

const renderDirectory = await mkdtemp(join(tmpdir(), "astralbeam-brand-"))

function prepareSvgForRendering(svg: string) {
  let prepared = svg
    .replaceAll("<symbol ", '<symbol overflow="visible" ')
    .replaceAll("<use ", '<use overflow="visible" ')

  if (!prepared.includes("<text")) {
    return prepared
  }

  prepared = prepared.replace(
    /<svg\b([^>]*?)viewBox="([^"]+)"([^>]*)>/u,
    (root, before: string, viewBox: string, after: string) => {
      const values = viewBox.trim().split(/\s+/u).map(Number)

      if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) {
        return root
      }

      const [x = 0, y = 0, width = 0, height = 0] = values
      const horizontalPadding = width * 0.04
      const verticalPadding = height * 0.04

      return `<svg width="${width}" height="${height}"${before}viewBox="${x - horizontalPadding} ${y - verticalPadding} ${width + horizontalPadding * 2} ${height + verticalPadding * 2}"${after}>`
    },
  )

  return prepared
}

try {
  await Promise.all(
    svgFiles.map(async (svgFile) => {
      const svg = await readFile(join(svgDirectory, svgFile), "utf8")
      await writeFile(join(renderDirectory, svgFile), prepareSvgForRendering(svg))
    }),
  )

  for (const svgFile of svgFiles) {
    const pngFile = `${svgFile.slice(0, -extname(svgFile).length)}.png`
    const pngPath = join(pngDirectory, pngFile)

    // Sharp/libvips renders SVG viewBox units at 72 DPI, so this is equivalent
    // to the original script's rsvg-convert --zoom behavior.
    const rendered = await sharp(join(renderDirectory, svgFile), {
      density: 72 * scale,
    })
      .png()
      .toBuffer({ resolveWithObject: true })

    const minimumHorizontalPadding = Math.ceil(rendered.info.width * 0.04)
    const minimumVerticalPadding = Math.ceil(rendered.info.height * 0.04)
    const maximumContentWidth = rendered.info.width - minimumHorizontalPadding * 2
    const maximumContentHeight = rendered.info.height - minimumVerticalPadding * 2
    const trimmed = await sharp(rendered.data)
      .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer({ resolveWithObject: true })

    let output = rendered.data

    if (trimmed.info.width > maximumContentWidth || trimmed.info.height > maximumContentHeight) {
      const resized = await sharp(trimmed.data)
        .resize({
          width: maximumContentWidth,
          height: maximumContentHeight,
          fit: "inside",
          withoutEnlargement: true,
        })
        .png()
        .toBuffer({ resolveWithObject: true })
      const horizontalPadding = rendered.info.width - resized.info.width
      const verticalPadding = rendered.info.height - resized.info.height

      output = await sharp(resized.data)
        .extend({
          top: Math.floor(verticalPadding / 2),
          bottom: Math.ceil(verticalPadding / 2),
          left: Math.floor(horizontalPadding / 2),
          right: Math.ceil(horizontalPadding / 2),
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png()
        .toBuffer()
    }

    await writeFile(pngPath, output)

    console.log(`Wrote ${relative(packageDirectory, pngPath)}`)
  }
} finally {
  await rm(renderDirectory, { recursive: true, force: true })
}
